import type { Database } from "../db/database.ts";
import { createRepositories } from "../db/repositories.ts";
import {
  canonicalJson,
  writeImmutableBytes,
  writeImmutableJsonl,
} from "./jsonl.ts";
import { candidateFromJob, parseLegacyJob, stableKey } from "./parser.ts";
import type {
  CandidateRecord,
  JsonObject,
  LegacyOadaReader,
  SourceMapping,
} from "./types.ts";

export async function inventoryFailures(options: {
  reader: LegacyOadaReader;
  failureIndexRoot: string;
  mappings: ReadonlyMap<string, SourceMapping>;
  objectDirectory: string;
}): Promise<
  {
    manifestPath: string;
    checkpointPath: string;
    candidates: readonly CandidateRecord[];
  }
> {
  const visited = new Set<string>();
  const jobs: CandidateRecord[] = [];
  await visitObject(
    options.reader,
    options.failureIndexRoot,
    visited,
    (path, value) => {
      const job = parseLegacyJob(path, value);
      if (job) jobs.push(candidateFromJob(job, options.mappings));
    },
  );
  const candidates = [
    ...new Map(jobs.map((candidate) => [candidate.candidateKey, candidate]))
      .values(),
  ]
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  const manifestPath = await writeImmutableJsonl(
    options.objectDirectory,
    "inventory-manifest",
    candidates,
  );
  const checkpointPath = await writeImmutableJsonl(
    options.objectDirectory,
    "inventory-checkpoint",
    [{
      kind: "legacy-oada-inventory-checkpoint",
      failureIndexRoot: options.failureIndexRoot,
      visitedObjectCount: visited.size,
      candidateCount: candidates.length,
      manifestPath,
    }],
  );
  return { manifestPath, checkpointPath, candidates };
}

export async function importMappings(
  database: Database,
  candidates: readonly CandidateRecord[],
  objectDirectory: string,
): Promise<string> {
  const results = await database.transaction(async (transaction) => {
    const repositories = createRepositories(transaction);
    const output: JsonObject[] = [];
    for (const candidate of candidates) {
      if (
        !candidate.mapping ||
        candidate.classification !== "already-completed" ||
        candidate.attachments.some((attachment) =>
          !attachment.entryId || !attachment.repository
        )
      ) {
        output.push({
          candidateKey: candidate.candidateKey,
          status: "skipped",
          classification: candidate.classification === "already-completed"
            ? "manual-review"
            : candidate.classification,
          reason:
            "Only independently completed records with repository and entry ID are imported as history.",
        });
        continue;
      }
      const snapshot = candidate.sourceSnapshot;
      if (!isObject(snapshot)) {
        output.push({
          candidateKey: candidate.candidateKey,
          status: "skipped",
          classification: "invalid-payload",
          reason: "sourceSnapshot is required for import-mappings",
        });
        continue;
      }
      const mapping = candidate.mapping;
      const source = await repositories.sources.upsertCanonicalSource({
        sourceSystem: mapping.sourceSystem,
        sourceId: mapping.sourceId,
        sourceVersion: mapping.sourceVersion,
        readinessHash: await sha256(canonicalJson(snapshot)),
        documentType: mapping.documentType ?? null,
        status: "ready",
        payload: snapshot,
        provenance: migrationProvenance(candidate),
      });
      const request = await repositories.syncRequests.createRequest({
        sourceDocumentId: source.id,
        requestKey: `legacy-oada-import:${candidate.candidateKey}`,
        reason: "historical legacy OADA mapping import",
        requestedVdocKeys: candidate.attachments.map((attachment) =>
          attachment.vdocKey
        ),
        provenance: migrationProvenance(candidate),
      });
      await repositories.syncRequests.markActive(request.id);
      for (const attachment of candidate.attachments) {
        const stored = await repositories.sources.upsertAttachment({
          sourceSystem: mapping.sourceSystem,
          sourceId: mapping.sourceId,
          sourceVersion: mapping.sourceVersion,
          vdocKey: attachment.vdocKey,
          byteReference: attachment.byteReference,
          contentType: attachment.contentType,
          fileName: attachment.fileName ?? null,
          checksum: await sha256(attachment.byteReference),
          payload: attachment.payload ?? {},
          provenance: migrationProvenance(candidate),
        });
        const delivery = await repositories.deliveries.createIdempotently({
          syncRequestId: request.id,
          sourceAttachmentId: stored.id,
          idempotencyKey:
            `legacy-oada:${candidate.candidateKey}:${attachment.vdocKey}`,
          payloadHash: await sha256(canonicalJson(attachment.payload ?? {})),
          action: "create",
          repository: attachment.repository ?? "legacy-unresolved",
          targetPath: attachment.targetPath ?? "/legacy",
          targetName: attachment.targetName ?? attachment.vdocKey,
          payload: attachment.payload ?? {},
          provenance: migrationProvenance(candidate),
        });
        await repositories.deliveries.finalize(delivery.id, "completed", {
          historical: true,
          importedBy: "legacy-oada-migration",
        });
        if (attachment.entryId && /^\d+$/.test(attachment.entryId)) {
          await repositories.deliveries.persistEntryId({
            deliveryId: delivery.id,
            entryId: attachment.entryId,
            provenance: migrationProvenance(candidate),
          });
        }
      }
      await repositories.syncRequests.finalize(request.id, "completed", {
        historical: true,
        importedBy: "legacy-oada-migration",
      });
      output.push({
        candidateKey: candidate.candidateKey,
        status: "completed",
        classification: "already-completed",
      });
    }
    return output;
  });
  return await writeImmutableJsonl(
    objectDirectory,
    "import-mappings-checkpoint",
    results,
  );
}

export async function stageFailures(options: {
  database: Database;
  reader: LegacyOadaReader;
  candidates: readonly CandidateRecord[];
  batchKey: string;
  objectDirectory: string;
}): Promise<string> {
  const batch = await options.database.transaction(async (transaction) => {
    const migrations = createRepositories(transaction).migrations;
    const batch = await migrations.upsertBatch({
      batchKey: options.batchKey,
      source: "legacy-oada-stage-failures",
      provenance: { tool: "legacy-oada-migration" },
    });
    await migrations.checkpointBatch(batch.id, "running", {
      batchKey: options.batchKey,
    }, { total: options.candidates.length });
    return batch;
  });
  const results: JsonObject[] = [];
  for (const candidate of options.candidates) {
    const item = await options.database.transaction(async (transaction) => {
      return await createRepositories(transaction).migrations.upsertItem({
        migrationBatchId: batch.id,
        itemKey: candidate.candidateKey,
        sourceVersion: candidate.mapping?.sourceVersion ?? null,
        payload: candidate,
      });
    });
    const mapping = candidate.mapping;
    if (!mapping || candidate.classification !== "safe-to-submit") {
      await options.database.transaction(async (transaction) => {
        await createRepositories(transaction).migrations.checkpointItem(
          item.id,
          "skipped",
          { classification: candidate.classification },
          { reason: candidate.reasons.join(" ") },
        );
      });
      results.push({
        candidateKey: candidate.candidateKey,
        status: "skipped",
        classification: candidate.classification,
      });
      continue;
    }
    try {
      const sourceSnapshot = await options.reader.getJson(
        mapping.sourcePath,
      );
      const attachments = await Promise.all(
        candidate.attachments.map(async (attachment) => {
          const bytes = await options.reader.getBytes(attachment.byteReference);
          const digest = await sha256Bytes(bytes);
          return {
            vdocKey: attachment.vdocKey,
            byteReference: attachment.byteReference,
            byteLength: bytes.byteLength,
            sha256: digest,
            objectPath: await writeImmutableBytes(
              options.objectDirectory,
              digest,
              bytes,
            ),
          };
        }),
      );
      await options.database.transaction(async (transaction) => {
        await createRepositories(transaction).migrations.checkpointItem(
          item.id,
          "completed",
          {
            sourcePath: mapping.sourcePath,
            attachmentCount: attachments.length,
          },
          { sourceSnapshot, attachments },
        );
      });
      results.push({
        candidateKey: candidate.candidateKey,
        status: "completed",
        classification: "safe-to-submit",
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown staging error";
      await options.database.transaction(async (transaction) => {
        await createRepositories(transaction).migrations.checkpointItem(
          item.id,
          "failed",
          {},
          null,
          message,
          true,
        );
      });
      results.push({
        candidateKey: candidate.candidateKey,
        status: "failed",
        classification: "missing-source",
        error: message,
      });
    }
  }
  const failed = results.filter((result) => result.status === "failed").length;
  await options.database.transaction(async (transaction) => {
    await createRepositories(transaction).migrations.checkpointBatch(
      batch.id,
      failed ? "partial" : "completed",
      { batchKey: options.batchKey },
      { total: results.length, failed },
    );
  });
  return await writeImmutableJsonl(
    options.objectDirectory,
    "stage-failures-checkpoint",
    results,
  );
}

async function visitObject(
  reader: LegacyOadaReader,
  path: string,
  visited: Set<string>,
  onObject: (path: string, value: JsonObject) => void,
): Promise<void> {
  if (visited.has(path)) return;
  if (visited.size >= 10_000) {
    throw new Error("Failure index traversal limit (10,000 objects) reached");
  }
  visited.add(path);
  const value = await reader.getJson(path);
  visitEmbedded(path, value, onObject);
  for (
    const [key, child] of Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    if (typeof child === "string" && child.startsWith("/")) {
      await visitObject(reader, child, visited, onObject);
    }
  }
}

function visitEmbedded(
  path: string,
  value: JsonObject,
  onObject: (path: string, value: JsonObject) => void,
): void {
  onObject(path, value);
  for (
    const [key, child] of Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    const childPath = `${path}/${encodeURIComponent(key)}`;
    if (isObject(child)) visitEmbedded(childPath, child, onObject);
    if (Array.isArray(child)) {
      child.forEach((entry, index) => {
        if (isObject(entry)) {
          visitEmbedded(`${childPath}/${index}`, entry, onObject);
        }
      });
    }
  }
}

function migrationProvenance(candidate: CandidateRecord): JsonObject {
  return {
    migration: "legacy-oada",
    candidateKey: candidate.candidateKey,
    legacyJobPath: candidate.legacyJobPath,
  };
}
async function sha256(value: string): Promise<string> {
  return await sha256Bytes(new TextEncoder().encode(value));
}
async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
