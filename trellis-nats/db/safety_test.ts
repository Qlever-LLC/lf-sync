import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1.0.16";
import type { QueryExecutor } from "./database.ts";
import { deliverySafetyMigration } from "./migrations/010_delivery_safety.ts";
import {
  DeliveryRepository,
  HealthRepository,
  SourceRepository,
  SyncRepository,
} from "./repositories.ts";

Deno.test("delivery safety migration persists revocations and sanitizes historical CWS failures", () => {
  assertStringIncludes(
    deliverySafetyMigration.sql,
    "source_approval_revocations",
  );
  assertStringIncludes(deliverySafetyMigration.sql, "upload_completed_at");
  assertStringIncludes(deliverySafetyMigration.sql, "submission_claimed_until");
  assertStringIncludes(deliverySafetyMigration.sql, "jsonb_agg(");
  assertStringIncludes(
    deliverySafetyMigration.sql,
    "No attachment deliveries were retained before migration 010",
  );
  assertStringIncludes(
    deliverySafetyMigration.sql,
    "reason = 'CWS submission failed'",
  );
  assertEquals(
    deliverySafetyMigration.sql.includes("DELETE FROM deliveries"),
    false,
  );
});

Deno.test("source approval work takes a transaction-scoped version lock", async () => {
  let query = "";
  let parameters: readonly unknown[] = [];
  const database = {
    query: (sql: string, values: readonly unknown[]) => {
      query = sql;
      parameters = values;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await new SourceRepository(database).lockApprovalVersion(
    "foodlogiq",
    "document-1",
    "version-1",
  );
  assertStringIncludes(query, "pg_advisory_xact_lock");
  assertStringIncludes(query, "hashtextextended");
  assertEquals(parameters, [
    'lf-sync:approval:["foodlogiq","document-1","version-1"]',
  ]);
});

Deno.test("approval revocation terminalizes existing requests in the locked version", async () => {
  let query = "";
  const database = {
    query: (sql: string) => {
      query = sql;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await new DeliveryRepository(database).markApprovalRevoked({
    sourceSystem: "foodlogiq",
    sourceId: "document-1",
    sourceVersion: "version-1",
    result: { reason: "revoked" },
  });
  assertStringIncludes(query, "UPDATE sync_requests AS request");
  assertStringIncludes(query, "status = 'approval-revoked'");
});

Deno.test("database readiness executes a live query", async () => {
  let queried = false;
  const database = {
    query: (sql: string) => {
      queried = true;
      assertStringIncludes(sql, "current_database()");
      assertStringIncludes(sql, "source_approval_revocations");
      assertStringIncludes(sql, "submission_claim_owner");
      return Promise.resolve([{
        databaseName: "lf_sync",
        serverVersion: "16",
        databaseTime: new Date(),
        migrationReady: true,
      }]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  const result = await new HealthRepository(database).health();
  assert(queried);
  assertEquals(result.ok, true);
  assertEquals(result.migrationReady, true);
});

Deno.test("database readiness rejects a connected database without migration 010", async () => {
  const database = {
    query: () =>
      Promise.resolve([{
        databaseName: "lf_sync",
        serverVersion: "16",
        databaseTime: new Date(),
        migrationReady: false,
      }]),
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await assertRejects(
    () => new HealthRepository(database).health(),
    Error,
    "migration 010",
  );
});

Deno.test("parent finalization aggregates all attachment terminal states", async () => {
  let query = "";
  const database = {
    query: (sql: string) => {
      query = sql;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await new SyncRepository(database).finalizeFromDeliveries("1");
  assertStringIncludes(query, "has_active");
  assertStringIncludes(query, "has_revoked");
  assertStringIncludes(query, "states.has_completed AND");
  assertStringIncludes(query, "states.expected_count > 0");
  assertStringIncludes(query, "states.delivery_count = states.expected_count");
});

Deno.test("sync requests persist canonical expected attachment keys", async () => {
  let parameters: readonly unknown[] = [];
  let query = "";
  const database = {
    query: (sql: string, values: readonly unknown[]) => {
      query = sql;
      parameters = values;
      return Promise.resolve([{}]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await new SyncRepository(database).createRequest({
    sourceDocumentId: "1",
    requestKey: "request-1",
    reason: "approved",
    requestedVdocKeys: ["b", "a", "b"],
  });
  assertEquals(parameters[5], '["a","b"]');
  assertStringIncludes(query, "requested_vdoc_keys = CASE");
});

Deno.test("submission lease renewal requires a live owner and valid approval", async () => {
  let query = "";
  const database = {
    query: (sql: string) => {
      query = sql;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  const renewed = await new DeliveryRepository(database).renewSubmissionClaim(
    "1",
    "owner-new",
    new Date(Date.now() + 60_000),
  );
  assertEquals(renewed, false);
  assertStringIncludes(query, "submission_claim_owner = $2");
  assertStringIncludes(query, "submission_claimed_until > now()");
  assertStringIncludes(query, "source_approval_revocations");
});

Deno.test("owner-fenced persistence rejects a stale submission worker", async () => {
  let query = "";
  const database = {
    query: (sql: string) => {
      query = sql;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;
  const repository = new DeliveryRepository(database);

  await assertRejects(
    () =>
      repository.persistContent({
        deliveryId: "1",
        claimOwner: "owner-old",
        directoryId: "2",
        sha256: "hash",
        byteLength: "1",
        contentType: "application/pdf",
        uploadExtension: "pdf",
      }),
    Error,
    "submission claim was lost",
  );
  assertStringIncludes(query, "submission_claim_owner = $7");
  assertStringIncludes(query, "submission_claimed_until > now()");
});

Deno.test("owner-fenced finalization rejects a stale submission worker", async () => {
  let query = "";
  const database = {
    query: (sql: string) => {
      query = sql;
      return Promise.resolve([]);
    },
    execute: () => Promise.resolve(),
  } as unknown as QueryExecutor;

  await assertRejects(
    () =>
      new DeliveryRepository(database).finalize(
        "1",
        "completed",
        {},
        "owner-old",
      ),
    Error,
  );
  assertStringIncludes(query, "submission_claim_owner = $4");
  assertStringIncludes(query, "submission_claimed_until > now()");
});

Deno.test("submission release cannot clear another owner's claim", async () => {
  let statement = "";
  let parameters: readonly unknown[] = [];
  const database = {
    query: () => Promise.resolve([]),
    execute: (sql: string, values: readonly unknown[]) => {
      statement = sql;
      parameters = values;
      return Promise.resolve();
    },
  } as unknown as QueryExecutor;

  await new DeliveryRepository(database).releaseSubmissionClaim(
    "1",
    "owner-old",
  );
  assertStringIncludes(statement, "submission_claim_owner = $2");
  assertEquals(parameters, ["1", "owner-old"]);
});
