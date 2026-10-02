import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.16";
import { prepareDelivery, submitDelivery } from "./delivery_workflow.ts";
import type { DeliveryRecord, ExistingDeliveryContentRecord, SourceAttachmentRecord, SourceDocumentRecord } from "../db/types.ts";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

Deno.test("submitDelivery denies CWS work outside enabled write mode", async () => {
  await assertRejects(() => submitDelivery({
    writeMode: "disabled", cws: cws(), attachmentClient: transferClient(),
    repositories: repositories(), delivery: delivery(), attachment: attachment(),
  }), Error, "LF_SYNC_WRITE_MODE");
});

Deno.test("prepareDelivery and submitDelivery create, upload, persist, and reuse the entry mapping", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  const repos = repositories(saved);
  const prepared = await prepareDelivery({
    repositories: repos,
    source: source(), attachment: attachment(), syncRequestId: "request-1",
    repository: "Repository", idempotencyKey: "prepare-1",
  });
  assertEquals(prepared.id, "delivery-1");
  const first = await submitDelivery({
    writeMode: "enabled", cws: cws(calls), attachmentClient: transferClient(),
    repositories: repos, delivery: prepared, attachment: attachment(),
  });
  assertEquals(first, { entryId: 42, cwsName: "coi.pdf", cwsPath: "\\coi.pdf", reviewRequired: false });
  assertEquals(calls, ["directory", "create", "upload"]);
  assertEquals(saved, ["content", "entry"]);

  calls.length = 0;
  saved.length = 0;
  const reused = await submitDelivery({
    writeMode: "enabled", cws: cws(calls), attachmentClient: transferClient(),
    repositories: repos, delivery: { ...prepared, entryId: "42" }, attachment: attachment(),
  });
  assertEquals(reused, { entryId: 42, reviewRequired: false });
  assertEquals(calls, ["directory"]);
  assertEquals(saved, ["content", "entry"]);
});

Deno.test("submitDelivery ensures the Laserfiche directory before creating or uploading the document", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  const result = await submitDelivery({
    writeMode: "enabled",
    cws: cws(calls),
    attachmentClient: transferClient(calls),
    repositories: repositories(saved),
    delivery: delivery(),
    attachment: attachment(),
  });

  assertEquals(result, { entryId: 42, cwsName: "coi.pdf", cwsPath: "\\coi.pdf", reviewRequired: false });
  assertEquals(calls, ["directory", "download", "create", "upload"]);
  assertEquals(saved, ["content", "entry"]);
});

Deno.test("submitDelivery reuses completed delivery content in the same directory", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  const result = await submitDelivery({
    writeMode: "enabled",
    cws: cws(calls),
    attachmentClient: transferClient(calls),
    repositories: repositories(saved, {
      deliveryId: "delivery-existing",
      entryId: "99",
      sha256: "unused",
      byteLength: "6",
      contentType: "application/pdf",
      uploadExtension: "pdf",
    }),
    delivery: delivery(),
    attachment: attachment(),
  });

  assertEquals(result, { entryId: 99, reviewRequired: false });
  assertEquals(calls, ["directory", "download"]);
  assertEquals(saved, ["duplicate-content", "reused-entry"]);
});

function source(): SourceDocumentRecord {
  return {
    id: "source-1", sourceSystem: "foodlogiq", sourceId: "document-1", sourceVersion: "version-1",
    readinessHash: "hash", documentType: "coi", supplierId: "supplier-1", supplierName: "Acme", status: "ready",
    payload: {
      supplier: { name: "Acme" },
      source: { documentTypeName: "COI", effectiveDate: "2026-01-01" },
    }, provenance: {}, approvedAt: null, sourceCreatedAt: null, sourceUpdatedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function attachment(): SourceAttachmentRecord {
  return {
    id: "attachment-1", sourceDocumentId: "source-1", sourceSystem: "foodlogiq",
    sourceId: "document-1", sourceVersion: "version-1", vdocKey: "vdoc-1",
    byteReference: "attachment-download-1", contentType: "application/pdf", fileName: "coi.pdf",
    sizeBytes: "6", checksum: null, payload: { fileName: "coi.pdf" }, provenance: {},
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function delivery(): DeliveryRecord {
  return {
    id: "delivery-1", syncRequestId: "request-1", sourceDocumentId: "source-1",
    sourceAttachmentId: "attachment-1", externalSourceDocumentId: "document-1", sourceVersion: "version-1",
    vdocKey: "vdoc-1", documentType: "coi", supplier: "Acme", idempotencyKey: "prepare-1",
    payloadHash: "payload", action: "create", status: "active", repository: "Repository",
    targetPath: "/trellis/trading-partners/Acme/Shared To Smithfield/COI", targetName: "coi.pdf",
    payload: { metadata: { Entity: "Acme" } }, provenance: {}, syncProvenance: null, result: null, byteLength: null, entryId: null,
    retryCount: 0, maxAttempts: 5, nextAttemptAt: null, lastRetryReason: null,
    approvedAt: null, requestedAt: new Date(), attemptCount: 0, failureCount: 0,
    startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function transferClient(calls: string[] = []) {
  return {
    documentsFilesDownload: () => {
      calls.push("download");
      return { orThrow: async () => ({ transfer: {} }) };
    },
    transfer: () => ({ bytes: () => ({ orThrow: async () => pdf }) }),
  };
}

function cws(calls: string[] = []) {
  return {
    ensureDirectory: async (path: string) => {
      calls.push("directory");
      const entries = path.split("/").filter(Boolean).map((name, index, segments) => ({
        entryId: 10 + index,
        name,
        type: "Folder",
        path: `\\${segments.slice(0, index + 1).join("\\")}`,
      }));
      return { canonicalPath: path, entries };
    },
    createDocument: async () => {
      calls.push("create");
      return { entryId: 42, name: "coi.pdf", type: "Document", path: "\\coi.pdf" };
    },
    uploadBuffer: async () => { calls.push("upload"); },
  };
}

function repositories(
  saved: string[] = [],
  existingContent: ExistingDeliveryContentRecord | null = null,
) {
  const record = delivery();
  return {
    directories: { upsertVerified: async () => ({ id: "directory-1" }) },
    syncRequests: { finalizeFromDeliveries: async () => null },
    deliveries: {
      createIdempotently: async () => record,
      markActive: async () => record,
      persistContent: async () => { saved.push("content"); },
      findExistingContent: async () => existingContent,
      persistDuplicateContent: async () => { saved.push("duplicate-content"); },
      persistReusedEntryId: async () => { saved.push("reused-entry"); },
      persistEntryId: async () => { saved.push("entry"); },
      finalize: async (_id: string, status: string) => {
        saved.push(`finalize:${status}`);
        return record;
      },
      recordAttempt: async () => ({}),
      queueSnapshot: async () => ({
        capturedAt: new Date(0).toISOString(),
        deliveriesByStatus: {},
        activeDeliveries: 0,
        openFailures: 0,
        oldestActiveDeliveryAgeSeconds: null,
      }),
      scheduleRetry: async () => { saved.push("schedule-retry"); },
      recordFailure: async (input: { stage: string }) => {
        saved.push(`failure:${input.stage}`);
        return { id: "failure-1" };
      },
    },
  };
}
