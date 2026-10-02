# Legacy OADA migration

`scripts/legacy-oada-migration.ts` is one-time migration tooling. It is not a
service entry point, does not import CWS code, never invokes CWS, and never
enqueues sync jobs. It only uses the existing PostgreSQL repositories when an
explicitly authorized database mutation is requested.

Production invocation is **not authorized by this code alone**. An approved
change, credentials with least privilege, a reviewed manifest, and
`LEGACY_OADA_MIGRATION_APPROVED=1` are all required.

## Prerequisites

- The target database schema is already migrated by the normal deployment
  process. This tool does not run schema migrations.
- `LEGACY_OADA_BASE_URL` is an explicit HTTPS URL and `LEGACY_OADA_TOKEN` is a
  read-only OADA token. Neither value is logged.
- `LF_SYNC_MIGRATION_OBJECT_DIRECTORY` names durable write-once artifact storage
  (defaults to `/var/lib/lf-sync/migration-objects`).
- A reviewed source-mapping JSONL exists. Every line must provide
  `legacySourceRef`, `sourceSystem`, `sourceId`, `sourceVersion`, and
  `sourcePath`; paths are intentionally not inferred from an unknown OADA tree.
- `DATABASE_URL` is required only for `--execute` mapping import or failure
  staging.

Example source mapping line:

```json
{
  "legacySourceRef": "/bookmarks/legacy/sources/42",
  "sourceSystem": "legacy-oada",
  "sourceId": "42",
  "sourceVersion": "2024-01-02T03:04:05Z",
  "sourcePath": "/bookmarks/legacy/sources/42",
  "documentType": "invoice"
}
```

## Commands

Inventory is read-only against OADA and is safe by default. It traverses the
supplied index root, handles embedded objects and absolute OADA references,
bounds traversal at 10,000 objects, deterministically deduplicates document/vdoc
candidates, and writes immutable JSONL manifest and checkpoint files.

```sh
LEGACY_OADA_BASE_URL=https://oada.example.com LEGACY_OADA_TOKEN="$TOKEN" \
deno run --allow-env --allow-net --allow-read --allow-write scripts/legacy-oada-migration.ts \
  --mode inventory --failure-index-root /bookmarks/legacy/failures \
  --source-mappings ./source-mappings.jsonl
```

Import mappings defaults to dry-run and emits only an immutable audit artifact.
Only records classified `already-completed` with a verified repository and entry
ID for every attachment can create historical completed-delivery projections. A
manifest record also needs a `sourceSnapshot` object. All other classifications
remain staged for review; no CWS request is made.

```sh
deno run --allow-env --allow-read --allow-write scripts/legacy-oada-migration.ts \
  --mode import-mappings --candidates ./reviewed-manifest.jsonl
```

```sh
LEGACY_OADA_MIGRATION_APPROVED=1 DATABASE_URL="$DATABASE_URL" \
deno run --allow-env --allow-net --allow-read --allow-write scripts/legacy-oada-migration.ts \
  --mode import-mappings --candidates ./reviewed-manifest.jsonl --execute
```

Failure staging reads candidate JSONL, fetches source snapshots and attachment
bytes through the OADA reader, writes content-addressed byte objects beneath the
migration object directory, and persists only migration batch/item checkpoints.
It does not create sync requests, deliveries, or CWS writes.

```sh
LEGACY_OADA_MIGRATION_APPROVED=1 DATABASE_URL="$DATABASE_URL" \
LEGACY_OADA_BASE_URL=https://oada.example.com LEGACY_OADA_TOKEN="$TOKEN" \
deno run --allow-env --allow-net --allow-read --allow-write scripts/legacy-oada-migration.ts \
  --mode stage-failures --candidates ./reviewed-manifest.jsonl --batch-key legacy-oada-2026-09-14 --execute
```

Database mutations require both `--execute` and
`LEGACY_OADA_MIGRATION_APPROVED=1`. The command refuses to connect to the
database without both gates. JSONL artifacts are created with unique names and
never overwritten; re-running an authorized command is resumable through
repository idempotency keys and migration batch/item keys.
