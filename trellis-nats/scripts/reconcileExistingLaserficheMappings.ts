import { loadConfig } from "../config.ts";
import { CwsAdapter, type CwsEntry } from "../cws.ts";
import { connectPostgres, type Database, type QueryExecutor } from "../db/mod.ts";

type Candidate = {
  id: string;
  syncRequestId: string;
  repository: string;
  targetPath: string;
  targetName: string;
  idempotencyKey: string;
  payloadHash: string;
  contentSha256: string | null;
  sourceChecksum: string | null;
  contentType: string | null;
  uploadExtension: string | null;
  payload: { metadata?: Record<string, unknown> } | null;
};

type DirectoryRecord = { id: string } & Record<string, unknown>;
type CwsFolderCache = {
  root(): Promise<CwsEntry>;
  contents(entryId: number): Promise<CwsEntry[]>;
  stats(): { folderContentHits: number; folderContentMisses: number };
};
type PlanEntry =
  | {
    action: "map-existing";
    deliveryId: string;
    entryId: number;
    targetPath: string;
    targetName: string;
    directories: CwsEntry[];
  }
  | {
    action: "repair-metadata";
    deliveryId: string;
    entryId: number;
    targetPath: string;
    targetName: string;
    expectedMetadata: Record<string, string | string[]>;
    differences: Array<{ field: string; expected: string[]; actual: string[] }>;
  }
  | ({ action: "exception"; deliveryId: string; category: string } & Record<string, unknown>);

const apply = Deno.args.includes("--apply");
const planPath = stringArg("--plan", "");
const applyPlanPath = stringArg("--apply-plan", "");
const repairLaserficheMetadata = Deno.args.includes("--repair-laserfiche-metadata");
const limit = limitArg("--limit", 100);
const status = stringArg("--status", "active");

const config = loadConfig();
if (!config.cwsApi || !config.cwsRepo || !config.cwsUser || !config.cwsPassword) {
  throw new Error("CWS configuration is required for Laserfiche reconciliation");
}

const database = connectPostgres(config.databaseUrl, { max: 2 });
try {
  const cws = new CwsAdapter(config);
  const folderCache = cwsFolderCache(cws);
  if (applyPlanPath) {
    await applyPlan(database, cws, applyPlanPath, { repairLaserficheMetadata });
    Deno.exit(0);
  }
  const rows = await candidates(database, status, limit);
  const ambiguousTargets = ambiguousTargetKeys(rows);
  let matched = 0;
  let skipped = 0;
  let exceptions = 0;
  const plan: PlanEntry[] = [];
  let inspected = 0;
  for (const row of rows) {
    inspected += 1;
    if (inspected === 1 || inspected % 100 === 0) {
      console.log(JSON.stringify({ event: "progress", inspected, total: rows.length, apply }));
    }
    const localExceptions = localExceptionChecks(row);
    for (const exception of localExceptions) {
      exceptions += 1;
      const entry = { action: "exception" as const, deliveryId: row.id, ...exception } as PlanEntry;
      plan.push(entry);
      console.log(JSON.stringify({ event: "exception", ...entry }));
    }
    const targetKey = `${row.targetPath}\n${row.targetName}`;
    const ambiguity = ambiguousTargets.get(targetKey);
    if (ambiguity) {
      skipped += 1;
      exceptions += 1;
      const entry: PlanEntry = {
        action: "exception",
        deliveryId: row.id,
        category: "ambiguous-target-name-multiple-source-hashes",
        targetPath: row.targetPath,
        targetName: row.targetName,
        sourceHashes: ambiguity.hashes,
        candidateDeliveryIds: ambiguity.deliveryIds,
      };
      plan.push(entry);
      console.log(JSON.stringify({ event: "exception", ...entry }));
      continue;
    }
    const result = await findExisting(folderCache, row.targetPath, row.targetName);
    if (result.kind !== "matched") {
      skipped += 1;
      exceptions += 1;
      const entry = { action: "exception" as const, deliveryId: row.id, ...remoteException(result) } as PlanEntry;
      plan.push(entry);
      console.log(JSON.stringify({ event: "exception", ...entry }));
      continue;
    }
    matched += 1;
    const mapEntry: PlanEntry = {
      action: "map-existing",
      deliveryId: row.id,
      entryId: result.entry.entryId,
      targetPath: row.targetPath,
      targetName: row.targetName,
      directories: result.directories,
    };
    plan.push(mapEntry);
    console.log(JSON.stringify({
      event: apply ? "map" : "would-map",
      deliveryId: row.id,
      entryId: result.entry.entryId,
      targetPath: row.targetPath,
      targetName: row.targetName,
    }));
    const metadataDiff = await metadataDifferences(cws, result.entry.entryId, expectedMetadata(row));
    if (metadataDiff.length > 0) {
      const repairEntry: PlanEntry = {
        action: "repair-metadata",
        deliveryId: row.id,
        entryId: result.entry.entryId,
        targetPath: row.targetPath,
        targetName: row.targetName,
        expectedMetadata: expectedMetadata(row),
        differences: metadataDiff,
      };
      plan.push(repairEntry);
      for (const difference of metadataDiff) {
        exceptions += 1;
        console.log(JSON.stringify({
          event: "exception",
          action: "exception",
          deliveryId: row.id,
          category: "missing-or-incorrect-laserfiche-metadata",
          entryId: result.entry.entryId,
          targetPath: row.targetPath,
          targetName: row.targetName,
          ...difference,
        }));
      }
    }
    if (!apply) continue;
    await database.transaction(async (tx) => {
      const directoryId = await persistDirectories(tx, row.repository, result.directories);
      await persistMapping(tx, row, result.entry, directoryId);
    });
  }
  if (planPath) await Deno.writeTextFile(planPath, plan.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  console.log(JSON.stringify({
    event: "complete",
    apply,
    planPath: planPath || undefined,
    cache: folderCache.stats(),
    inspected: rows.length,
    matched,
    skipped,
    exceptions,
  }));
} finally {
  await database.close();
}

function ambiguousTargetKeys(rows: readonly Candidate[]): Map<string, { hashes: string[]; deliveryIds: string[] }> {
  const grouped = new Map<string, { hashes: Set<string>; deliveryIds: string[] }>();
  for (const row of rows) {
    const key = `${row.targetPath}\n${row.targetName}`;
    const hash = row.contentSha256 ?? row.sourceChecksum;
    if (!hash) continue;
    const group = grouped.get(key) ?? { hashes: new Set<string>(), deliveryIds: [] };
    group.hashes.add(hash);
    group.deliveryIds.push(row.id);
    grouped.set(key, group);
  }
  const ambiguous = new Map<string, { hashes: string[]; deliveryIds: string[] }>();
  for (const [key, group] of grouped) {
    if (group.hashes.size > 1) {
      ambiguous.set(key, { hashes: [...group.hashes].sort(), deliveryIds: group.deliveryIds });
    }
  }
  return ambiguous;
}

async function applyPlan(
  database: Database,
  cws: CwsAdapter,
  path: string,
  options: { repairLaserficheMetadata: boolean },
): Promise<void> {
  const entries = (await Deno.readTextFile(path)).split("\n").filter(Boolean).map((line) => JSON.parse(line) as PlanEntry);
  let mapped = 0;
  let metadataRepaired = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (entry.action === "exception") {
      skipped += 1;
      continue;
    }
    if (entry.action === "repair-metadata") {
      if (!options.repairLaserficheMetadata) {
        skipped += 1;
        continue;
      }
      await cws.setMetadata(entry.entryId, entry.expectedMetadata);
      metadataRepaired += 1;
      console.log(JSON.stringify({ event: "repaired-metadata", deliveryId: entry.deliveryId, entryId: entry.entryId }));
      continue;
    }
    const row = await candidateById(database, entry.deliveryId);
    if (!row) {
      skipped += 1;
      console.log(JSON.stringify({ event: "skip", category: "candidate-not-found", deliveryId: entry.deliveryId }));
      continue;
    }
    await database.transaction(async (tx) => {
      const directoryId = await persistDirectories(tx, row.repository, entry.directories);
      await persistMapping(tx, row, { entryId: entry.entryId, name: entry.targetName, path: cwsPath(entry), type: "document" }, directoryId);
    });
    mapped += 1;
    console.log(JSON.stringify({ event: "mapped", deliveryId: entry.deliveryId, entryId: entry.entryId }));
  }
  console.log(JSON.stringify({ event: "apply-plan-complete", path, mapped, metadataRepaired, skipped }));
}

async function candidates(database: Database, deliveryStatus: string, maxRows: number): Promise<Candidate[]> {
  const limitClause = Number.isFinite(maxRows) ? "LIMIT $2" : "";
  return await database.query<Candidate>(
    `
    SELECT d.id::text AS id,
           d.sync_request_id::text AS "syncRequestId",
           d.repository,
           d.target_path AS "targetPath",
           d.target_name AS "targetName",
           d.idempotency_key AS "idempotencyKey",
           d.payload_hash AS "payloadHash",
           d.content_sha256 AS "contentSha256",
           sa.checksum AS "sourceChecksum",
           d.content_type AS "contentType",
           d.upload_extension AS "uploadExtension",
           d.payload
    FROM deliveries AS d
    JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
    LEFT JOIN entry_mappings AS em ON em.delivery_id = d.id
    WHERE d.status = $1
      AND d.cws_entry_id IS NULL
      AND em.id IS NULL
    ORDER BY d.created_at, d.id
    ${limitClause}
  `,
    Number.isFinite(maxRows) ? [deliveryStatus, maxRows] : [deliveryStatus],
  );
}

async function candidateById(database: Database, deliveryId: string): Promise<Candidate | undefined> {
  const rows = await database.query<Candidate>(
    `
    SELECT d.id::text AS id,
           d.sync_request_id::text AS "syncRequestId",
           d.repository,
           d.target_path AS "targetPath",
           d.target_name AS "targetName",
           d.idempotency_key AS "idempotencyKey",
           d.payload_hash AS "payloadHash",
           d.content_sha256 AS "contentSha256",
           sa.checksum AS "sourceChecksum",
           d.content_type AS "contentType",
           d.upload_extension AS "uploadExtension",
           d.payload
    FROM deliveries AS d
    JOIN source_attachments AS sa ON sa.id = d.source_attachment_id
    WHERE d.id = $1
    LIMIT 1
  `,
    [deliveryId],
  );
  return rows[0];
}

function localExceptionChecks(row: Candidate): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const metadata = row.payload?.metadata ?? {};
  for (const field of ["Entity", "Document Type", "Document Date", "Original Filename"]) {
    const value = metadata[field];
    if (typeof value !== "string" || !value.trim()) {
      found.push({ category: "missing-metadata", field, targetPath: row.targetPath, targetName: row.targetName });
    }
  }
  const originalFilename = metadata["Original Filename"];
  if (typeof originalFilename === "string" && originalFilename.trim() && originalFilename !== row.targetName) {
    found.push({
      category: "incorrect-naming-scheme",
      field: "Original Filename",
      expected: originalFilename,
      actual: row.targetName,
      targetPath: row.targetPath,
      targetName: row.targetName,
    });
  }
  const targetExtension = extension(row.targetName);
  if (row.uploadExtension && targetExtension && row.uploadExtension.toLowerCase() !== targetExtension.toLowerCase()) {
    found.push({
      category: "incorrect-file-format-assignment",
      expectedExtension: targetExtension,
      actualUploadExtension: row.uploadExtension,
      contentType: row.contentType,
      targetPath: row.targetPath,
      targetName: row.targetName,
    });
  }
  if (!row.contentSha256 && !row.sourceChecksum) {
    found.push({ category: "missing-content-hash", targetPath: row.targetPath, targetName: row.targetName });
  }
  return found;
}

async function metadataDifferences(
  cws: CwsAdapter,
  entryId: number,
  expected: Record<string, string | string[]>,
): Promise<Array<{ field: string; expected: string[]; actual: string[] }>> {
  const current = await cws.metadata(entryId);
  const actual = new Map(current.fields.map((field) => [field.name, [...field.values]]));
  return Object.entries(expected).flatMap(([field, value]) => {
    const expectedValues = Array.isArray(value) ? value : [value];
    const actualValues = actual.get(field) ?? [];
    return sameMetadataValues(field, expectedValues, actualValues) ? [] : [{ field, expected: expectedValues, actual: actualValues }];
  });
}

function expectedMetadata(row: Candidate): Record<string, string | string[]> {
  const metadata = row.payload?.metadata ?? {};
  const entries: Array<[string, string | string[]]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") entries.push([key, value]);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function sameMetadataValues(field: string, left: readonly string[], right: readonly string[]): boolean {
  if (field === "Document Date" || field === "Expiration Date") {
    return sameValues(left.map(normalizedMetadataDate), right.map(normalizedMetadataDate));
  }
  return sameValues(left, right);
}

function sameValues(left: readonly (string | undefined)[], right: readonly (string | undefined)[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedMetadataDate(value: string): string | undefined {
  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(trimmed);
  if (iso) return iso[1];
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/.exec(trimmed);
  if (slash) {
    const [, rawMonth, rawDay, rawYear] = slash;
    if (rawMonth && rawDay && rawYear) {
      const month = rawMonth.padStart(2, "0");
      const day = rawDay.padStart(2, "0");
      return `${rawYear}-${month}-${day}`;
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function cwsPath(entry: { targetPath: string; targetName: string }): string {
  return `${entry.targetPath.replaceAll("/", "\\")}\\${entry.targetName}`;
}

function cwsFolderCache(cws: CwsAdapter): CwsFolderCache {
  let root: Promise<CwsEntry> | undefined;
  const contents = new Map<number, Promise<CwsEntry[]>>();
  let folderContentHits = 0;
  let folderContentMisses = 0;
  return {
    root() {
      root ??= cws.retrieveEntryById(1);
      return root;
    },
    contents(entryId: number) {
      const cached = contents.get(entryId);
      if (cached) {
        folderContentHits += 1;
        return cached;
      }
      folderContentMisses += 1;
      const loaded = cws.folderContents(entryId);
      contents.set(entryId, loaded);
      return loaded;
    },
    stats() {
      return { folderContentHits, folderContentMisses };
    },
  };
}

function remoteException(result: Exclude<Awaited<ReturnType<typeof findExisting>>, { kind: "matched" }>): Record<string, unknown> {
  switch (result.kind) {
    case "missing-directory":
      return { category: "missing-laserfiche-directory", ...result };
    case "missing-document":
      return { category: "missing-laserfiche-document", ...result };
    case "ambiguous-document":
      return { category: "duplicate-document", ...result };
  }
}

function extension(name: string): string | undefined {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1) : undefined;
}

async function findExisting(
  cws: CwsFolderCache,
  targetPath: string,
  targetName: string,
): Promise<
  | { kind: "matched"; directories: CwsEntry[]; entry: CwsEntry }
  | { kind: "missing-directory"; missingSegment: string; targetPath: string; targetName: string }
  | { kind: "missing-document"; targetPath: string; targetName: string }
  | { kind: "ambiguous-document"; targetPath: string; targetName: string; matches: number[] }
> {
  const directories: CwsEntry[] = [];
  let parent = await cws.root();
  for (const segment of targetPath.split("/").filter(Boolean)) {
    const found = (await cws.contents(parent.entryId)).find((entry) =>
      entry.type.toLowerCase() === "folder" && entry.name === segment
    );
    if (!found) return { kind: "missing-directory", missingSegment: segment, targetPath, targetName };
    directories.push(found);
    parent = found;
  }
  const matches = (await cws.contents(parent.entryId)).filter((entry) =>
    entry.type.toLowerCase() !== "folder" && entry.name === targetName
  );
  if (matches.length === 0) return { kind: "missing-document", targetPath, targetName };
  if (matches.length > 1) {
    return { kind: "ambiguous-document", targetPath, targetName, matches: matches.map((entry) => entry.entryId) };
  }
  const entry = matches[0];
  if (!entry) return { kind: "missing-document", targetPath, targetName };
  return { kind: "matched", directories, entry };
}

async function persistDirectories(
  tx: QueryExecutor,
  repository: string,
  directories: CwsEntry[],
): Promise<string> {
  let parentId: string | null = null;
  let canonicalPath = "";
  for (const directory of directories) {
    canonicalPath += `/${directory.name}`;
    const rows: DirectoryRecord[] = await tx.query<DirectoryRecord>(
      `
      INSERT INTO laserfiche_directories (
        repository, canonical_path, parent_directory_id, cws_entry_id, name,
        status, verified_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, 'verified', now(), $6::jsonb)
      ON CONFLICT (repository, canonical_path) DO UPDATE
      SET parent_directory_id = EXCLUDED.parent_directory_id,
          cws_entry_id = EXCLUDED.cws_entry_id,
          name = EXCLUDED.name,
          status = 'verified',
          verified_at = now(),
          metadata = EXCLUDED.metadata,
          updated_at = now()
      RETURNING id::text AS id
    `,
      [
        repository,
        canonicalPath,
        parentId,
        directory.entryId,
        directory.name,
        JSON.stringify({ cwsPath: directory.path, reconciledFromExistingLaserfiche: true }),
      ],
    );
    const row = rows[0];
    if (!row) throw new Error(`Directory ${canonicalPath} was not persisted`);
    parentId = row.id;
  }
  if (!parentId) throw new Error("No directory rows were reconciled");
  return parentId;
}

async function persistMapping(
  tx: QueryExecutor,
  row: Candidate,
  entry: CwsEntry,
  directoryId: string,
): Promise<void> {
  const sha256 = row.contentSha256 ?? row.sourceChecksum;
  const existing = await tx.query<{ deliveryId: string }>(
    `SELECT delivery_id::text AS "deliveryId" FROM entry_mappings WHERE repository = $1 AND entry_id = $2 LIMIT 1`,
    [row.repository, entry.entryId],
  );
  if (existing[0] && existing[0].deliveryId !== row.id) {
    await persistReusedEntryReference(tx, row, entry, directoryId, sha256);
    return;
  }
  const provenance = JSON.stringify({
    reconciledFromExistingLaserfiche: true,
    reconciledAt: new Date().toISOString(),
    evidence: "exact-target-path-and-name",
    cwsPath: entry.path,
    ...(sha256 ? { sourceSha256: sha256 } : {}),
  });
  await tx.execute(
    `
    INSERT INTO entry_mappings (
      delivery_id, repository, entry_id, idempotency_key, payload_hash,
      content_sha256, provenance, verified_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
    ON CONFLICT (delivery_id) DO UPDATE
    SET entry_id = EXCLUDED.entry_id,
        content_sha256 = EXCLUDED.content_sha256,
        provenance = EXCLUDED.provenance,
        verified_at = now(),
        updated_at = now()
  `,
    [row.id, row.repository, entry.entryId, row.idempotencyKey, row.payloadHash, sha256, provenance],
  );
  await tx.execute(
    `
    UPDATE deliveries
    SET directory_id = $2,
        cws_entry_id = $3,
        content_sha256 = COALESCE(content_sha256, $4),
        status = 'completed',
        result = $5::jsonb,
        finished_at = now(),
        updated_at = now()
    WHERE id = $1
  `,
    [
      row.id,
      directoryId,
      entry.entryId,
      sha256,
      JSON.stringify({ laserficheEntryId: entry.entryId, reconciledFromExistingLaserfiche: true }),
    ],
  );
  await tx.execute(
    `
    UPDATE sync_requests AS sr
    SET status = 'completed', finished_at = now(), updated_at = now(),
        result = jsonb_build_object('reconciledFromExistingLaserfiche', true)
    WHERE sr.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM deliveries AS d
        WHERE d.sync_request_id = sr.id
          AND d.status <> 'completed'
      )
  `,
    [row.syncRequestId],
  );
}

async function persistReusedEntryReference(
  tx: QueryExecutor,
  row: Candidate,
  entry: CwsEntry,
  directoryId: string,
  _sha256: string | null | undefined,
): Promise<void> {
  await tx.execute(
    `
    UPDATE deliveries
    SET directory_id = $2,
        cws_entry_id = $3,
        status = 'completed',
        result = $4::jsonb,
        finished_at = now(),
        updated_at = now()
    WHERE id = $1
  `,
    [
      row.id,
      directoryId,
      entry.entryId,
      JSON.stringify({ laserficheEntryId: entry.entryId, reusedExistingEntryMapping: true }),
    ],
  );
  await tx.execute(
    `
    UPDATE sync_requests AS sr
    SET status = 'completed', finished_at = now(), updated_at = now(),
        result = jsonb_build_object('reconciledFromExistingLaserfiche', true)
    WHERE sr.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM deliveries AS d
        WHERE d.sync_request_id = sr.id
          AND d.status <> 'completed'
      )
  `,
    [row.syncRequestId],
  );
}

function stringArg(name: string, fallback: string): string {
  const index = Deno.args.indexOf(name);
  const value = index >= 0 ? Deno.args[index + 1] : undefined;
  return value ? value : fallback;
}

function numberArg(name: string, fallback: number): number {
  const value = stringArg(name, String(fallback));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function limitArg(name: string, fallback: number): number {
  const value = stringArg(name, String(fallback));
  if (value === "all" || value === "unlimited") return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer or 'all'`);
  return parsed;
}
