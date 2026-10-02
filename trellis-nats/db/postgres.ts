import postgres from "npm:postgres@3.4.7";
import { drizzle } from "drizzle-orm/postgres-js";
import type {
  Database,
  DatabaseRow,
  LfSyncDrizzleDatabase,
  QueryExecutor,
  SqlParameter,
} from "./database.ts";
import * as schema from "./schema.ts";

type UnsafeClient = {
  unsafe(
    text: string,
    parameters?: PostgresParameter[],
  ): PromiseLike<Iterable<DatabaseRow>>;
};

type PostgresParameter =
  | string
  | number
  | bigint
  | boolean
  | Date
  | Uint8Array
  | null;

class PostgresExecutor implements QueryExecutor {
  constructor(
    private readonly client: UnsafeClient,
    readonly drizzle: LfSyncDrizzleDatabase,
  ) {}

  async query<TRow extends DatabaseRow = DatabaseRow>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<TRow[]> {
    const normalized = normalizePostgresParameters(parameters);
    const rows = parameters.length === 0
      ? await this.client.unsafe(text)
      : await this.client.unsafe(text, normalized);
    return Array.from(rows) as TRow[];
  }

  async execute(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<void> {
    if (parameters.length === 0) {
      await this.client.unsafe(text);
    } else {
      await this.client.unsafe(text, normalizePostgresParameters(parameters));
    }
  }
}

export type PostgresOptions = NonNullable<Parameters<typeof postgres>[1]>;

export function connectPostgres(
  connectionString: string,
  options: PostgresOptions = {},
): Database {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ...options,
  });
  const drizzleDatabase = drizzle(client, { schema });
  const executor = new PostgresExecutor(
    client as unknown as UnsafeClient,
    drizzleDatabase,
  );

  return {
    drizzle: executor.drizzle,
    query: executor.query.bind(executor),
    execute: executor.execute.bind(executor),
    async transaction<TResult>(
      callback: (transaction: QueryExecutor) => Promise<TResult>,
    ): Promise<TResult> {
      const result = await client.begin(async (transaction) => {
        const transactionExecutor = new PostgresExecutor(
          transaction as unknown as UnsafeClient,
          // postgres.js transaction scopes do not expose the driver options
          // Drizzle needs to construct a second scoped client. Raw SQL callers
          // still receive the real transaction executor.
          drizzleDatabase,
        );
        return { value: await callback(transactionExecutor) };
      });
      return result.value;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

function normalizePostgresParameters(
  parameters: readonly SqlParameter[],
): PostgresParameter[] {
  return parameters.map((parameter, index) => {
    if (
      parameter === null || typeof parameter === "string" ||
      typeof parameter === "boolean" || typeof parameter === "bigint" ||
      parameter instanceof Uint8Array
    ) {
      return parameter;
    }
    if (typeof parameter === "number" && Number.isFinite(parameter)) {
      return parameter;
    }
    if (parameter instanceof Date && !Number.isNaN(parameter.getTime())) {
      // postgres.js unsafe queries do not encode Date values themselves.
      return parameter.toISOString();
    }
    throw new TypeError(
      `Unsupported PostgreSQL parameter at index ${index}: ${typeof parameter}`,
    );
  });
}
