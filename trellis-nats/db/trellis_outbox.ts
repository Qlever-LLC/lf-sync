import {
  createSqlOutboxAdapter,
  type SqlExecutor,
  type SqlOutboxAdapter,
  type SqlOutboxTables,
  type SqlRow,
} from "@qlever-llc/trellis/service";
import type { DatabaseRow, QueryExecutor } from "./database.ts";

export const trellisSqlOutboxTables: SqlOutboxTables = Object.freeze({
  outbox: "trellis_outbox",
  inbox: "trellis_inbox",
});

export function createTrellisSqlOutboxAdapter(
  executor: QueryExecutor,
): SqlOutboxAdapter {
  const sqlExecutor: SqlExecutor = {
    async query(
      sql: string,
      parameters: readonly unknown[],
    ): Promise<SqlRow[]> {
      const rows = await executor.query(sql, parameters);
      return rows.map(toTrellisRow);
    },
    async execute(
      sql: string,
      parameters: readonly unknown[],
    ): Promise<void> {
      await executor.execute(sql, parameters);
    },
  };

  return createSqlOutboxAdapter(
    sqlExecutor,
    "postgres",
    trellisSqlOutboxTables,
  );
}

function toTrellisRow(row: DatabaseRow): SqlRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}
