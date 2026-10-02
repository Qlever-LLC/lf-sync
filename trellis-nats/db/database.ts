import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.ts";

export type SqlParameter = unknown;

export type DatabaseRow = Record<string, unknown>;
export type LfSyncDrizzleDatabase = PostgresJsDatabase<typeof schema>;

export interface QueryExecutor {
  readonly drizzle: LfSyncDrizzleDatabase;
  query<TRow extends DatabaseRow = DatabaseRow>(
    text: string,
    parameters?: readonly SqlParameter[],
  ): Promise<TRow[]>;
  execute(
    text: string,
    parameters?: readonly SqlParameter[],
  ): Promise<void>;
}

export interface Database extends QueryExecutor {
  transaction<TResult>(
    callback: (transaction: QueryExecutor) => Promise<TResult>,
  ): Promise<TResult>;
  close(): Promise<void>;
}
