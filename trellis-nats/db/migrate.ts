import type { Database, QueryExecutor } from "./database.ts";
import {
  type Migration,
  migrations as defaultMigrations,
} from "./migrations/index.ts";

const MIGRATION_LOCK_NAME = "lf-sync:database-migrations";

interface AppliedMigration extends Record<string, unknown> {
  version: number;
  name: string;
  checksum: string;
}

export interface MigrationResult {
  applied: readonly number[];
  currentVersion: number;
}

export async function runMigrations(
  database: Database,
  migrations: readonly Migration[] = defaultMigrations,
): Promise<MigrationResult> {
  validateMigrations(migrations);

  return await database.transaction(async (transaction) => {
    await transaction.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [MIGRATION_LOCK_NAME],
    );
    await ensureLedger(transaction);

    const appliedRows = await transaction.query<AppliedMigration>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    );
    const applied: number[] = [];

    if (appliedRows.length > migrations.length) {
      throw new Error("The migration ledger contains unknown versions");
    }

    for (const [index, existing] of appliedRows.entries()) {
      const migration = migrations[index];
      if (!migration || existing.version !== migration.version) {
        throw new Error(
          "The migration ledger is not an exact migration prefix",
        );
      }
      const checksum = migration.checksum ?? await sha256(migration.sql);
      if (existing.name !== migration.name || existing.checksum !== checksum) {
        throw new Error(
          `Migration ${migration.version} differs from the applied ledger entry`,
        );
      }
    }

    for (const migration of migrations.slice(appliedRows.length)) {
      const checksum = migration.checksum ?? await sha256(migration.sql);
      await transaction.execute(migration.sql);
      await transaction.execute(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, checksum],
      );
      applied.push(migration.version);
    }

    return {
      applied,
      currentVersion: migrations.at(-1)?.version ??
        appliedRows.at(-1)?.version ?? 0,
    };
  });
}

async function ensureLedger(transaction: QueryExecutor): Promise<void> {
  await transaction.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
      checksum text NOT NULL CHECK (btrim(checksum) <> ''),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function validateMigrations(migrations: readonly Migration[]): void {
  let previousVersion = 0;
  const names = new Set<string>();
  for (const migration of migrations) {
    if (
      !Number.isInteger(migration.version) ||
      migration.version <= previousVersion
    ) {
      throw new Error(
        "Migrations must have unique, ascending positive versions",
      );
    }
    if (!migration.name || names.has(migration.name)) {
      throw new Error("Migrations must have unique, non-empty names");
    }
    previousVersion = migration.version;
    names.add(migration.name);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
