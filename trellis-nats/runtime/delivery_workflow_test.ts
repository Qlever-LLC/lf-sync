import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.16";
import {
  prepareDelivery,
  submitDelivery,
  terminalizeEmptySourceRequest,
} from "./delivery_workflow.ts";
import {
  startSubmissionLease,
  SubmissionFencedError,
} from "./submission_lease.ts";
import type {
  DeliveryRecord,
  ExistingDeliveryContentRecord,
  SourceAttachmentRecord,
  SourceDocumentRecord,
} from "../db/types.ts";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

Deno.test("submitDelivery retains shadow work outside enabled write mode", async () => {
  assertEquals(
    await submitDelivery({
      writeMode: "disabled",
      cws: cws(),
      attachmentClient: transferClient(),
      repositories: repositories(),
      delivery: delivery(),
      attachment: attachment(),
      ...submissionGuard(),
    }),
    { reviewRequired: false, deferred: true },
  );
});

Deno.test("prepareDelivery leaves shadow deliveries pending for later activation", async () => {
  const repos = repositories();
  const pending = { ...delivery(), status: "pending" as const };
  repos.deliveries.createIdempotently = async () => pending;
  repos.deliveries.markActive = () => {
    throw new Error("must not activate shadow delivery");
  };
  const result = await prepareDelivery({
    repositories: repos,
    source: source(),
    attachment: attachment(),
    syncRequestId: "request-1",
    repository: "Repository",
    idempotencyKey: "prepare-shadow",
    activate: false,
  });
  assertEquals(result.status, "pending");
});

Deno.test("an empty loaded source terminalizes its request as failed", async () => {
  let finalized: unknown[] = [];
  await terminalizeEmptySourceRequest({
    finalize: (...input: unknown[]) => {
      finalized = input;
      return Promise.resolve({});
    },
  }, "request-1");
  assertEquals(finalized, [
    "request-1",
    "failed",
    { reason: "Source document has no files" },
  ]);
});

Deno.test("submission lease heartbeat renews the same owner until stopped", async () => {
  const calls: Array<[string, string]> = [];
  const lease = startSubmissionLease({
    deliveryId: "delivery-1",
    claimOwner: "owner-1",
    intervalMs: 5,
    leaseMs: 50,
    renew: (deliveryId, owner) => {
      calls.push([deliveryId, owner]);
      return Promise.resolve(true);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 18));
  await lease.stop();
  const countAfterStop = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(countAfterStop > 0, true);
  assertEquals(calls, Array(countAfterStop).fill(["delivery-1", "owner-1"]));
});

Deno.test("prepareDelivery and submitDelivery create, upload, persist, and reuse the entry mapping", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  const repos = repositories(saved);
  const prepared = await prepareDelivery({
    repositories: repos,
    source: source(),
    attachment: attachment(),
    syncRequestId: "request-1",
    repository: "Repository",
    idempotencyKey: "prepare-1",
  });
  assertEquals(prepared.id, "delivery-1");
  const first = await submitDelivery({
    writeMode: "enabled",
    cws: cws(calls),
    attachmentClient: transferClient(),
    repositories: repos,
    delivery: prepared,
    attachment: attachment(),
    ...submissionGuard(),
  });
  assertEquals(first, {
    entryId: 42,
    cwsName: "coi.pdf",
    cwsPath: "\\coi.pdf",
    reviewRequired: false,
  });
  assertEquals(calls, ["directory", "create", "upload"]);
  assertEquals(saved, ["content", "entry", "uploaded"]);

  calls.length = 0;
  saved.length = 0;
  const reused = await submitDelivery({
    writeMode: "enabled",
    cws: cws(calls),
    attachmentClient: transferClient(),
    repositories: repos,
    delivery: { ...prepared, entryId: "42" },
    attachment: attachment(),
    ...submissionGuard(),
  });
  assertEquals(reused, { entryId: 42, reviewRequired: false });
  assertEquals(calls, ["directory", "upload"]);
  assertEquals(saved, ["content", "uploaded"]);
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
    ...submissionGuard(),
  });

  assertEquals(result, {
    entryId: 42,
    cwsName: "coi.pdf",
    cwsPath: "\\coi.pdf",
    reviewRequired: false,
  });
  assertEquals(calls, ["directory", "download", "create", "upload"]);
  assertEquals(saved, ["content", "entry", "uploaded"]);
});

Deno.test("submitDelivery persists the entry checkpoint before an upload failure", async () => {
  const saved: string[] = [];
  let failure: Record<string, unknown> | undefined;
  const repos = repositories(saved);
  repos.deliveries.recordFailure = async (input: Record<string, unknown>) => {
    failure = input;
    return { id: "failure-1" };
  };
  repos.deliveries.queueSnapshot = () =>
    Promise.reject(new Error("queue database secret"));
  const client = cws();
  client.uploadBuffer = () => {
    assertEquals(saved.includes("entry"), true);
    throw new Error("vendor body must not escape");
  };

  await submitDelivery({
    writeMode: "enabled",
    cws: client,
    attachmentClient: transferClient(),
    repositories: repos,
    delivery: delivery(),
    attachment: attachment(),
    ...submissionGuard(),
  }).catch(() => undefined);

  assertEquals(failure?.reason, "CWS submission failed");
  assertEquals(JSON.stringify(failure).includes("vendor body"), false);
  assertEquals(
    JSON.stringify(failure).includes("queue database secret"),
    false,
  );
});

Deno.test("submitDelivery skips an upload with a completed checkpoint", async () => {
  const calls: string[] = [];
  const result = await submitDelivery({
    writeMode: "enabled",
    cws: cws(calls),
    attachmentClient: transferClient(calls),
    repositories: repositories(),
    delivery: {
      ...delivery(),
      entryId: "42",
      uploadCompletedAt: new Date(),
    },
    attachment: attachment(),
    ...submissionGuard(),
  });

  assertEquals(result, { entryId: 42, reviewRequired: false });
  assertEquals(calls, []);
});

Deno.test("revocation during download suppresses create and upload", async () => {
  const calls: string[] = [];
  let revoked = false;
  const transfer = transferClient(calls);
  transfer.transfer = () => ({
    bytes: () => ({
      orThrow: async () => {
        revoked = true;
        return pdf;
      },
    }),
  });

  await assertRejects(
    () =>
      submitDelivery({
        writeMode: "enabled",
        cws: cws(calls),
        attachmentClient: transfer,
        repositories: repositories(),
        delivery: delivery(),
        attachment: attachment(),
        ...submissionGuard(() => revoked),
      }),
    SubmissionFencedError,
  );
  assertEquals(calls.includes("create"), false);
  assertEquals(calls.includes("upload"), false);
});

Deno.test("revocation during create checkpoints the entry but suppresses upload", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  let revoked = false;
  const client = cws(calls);
  client.createDocument = async () => {
    calls.push("create");
    revoked = true;
    return {
      entryId: 42,
      name: "coi.pdf",
      type: "Document",
      path: "\\coi.pdf",
    };
  };

  await assertRejects(
    () =>
      submitDelivery({
        writeMode: "enabled",
        cws: client,
        attachmentClient: transferClient(calls),
        repositories: repositories(saved),
        delivery: delivery(),
        attachment: attachment(),
        ...submissionGuard(() => revoked),
      }),
    SubmissionFencedError,
  );
  assertEquals(saved.includes("entry"), true);
  assertEquals(calls.includes("upload"), false);
});

Deno.test("revocation during upload records completion but suppresses success", async () => {
  const calls: string[] = [];
  const saved: string[] = [];
  let revoked = false;
  const client = cws(calls);
  client.uploadBuffer = async () => {
    calls.push("upload");
    revoked = true;
  };

  await assertRejects(
    () =>
      submitDelivery({
        writeMode: "enabled",
        cws: client,
        attachmentClient: transferClient(calls),
        repositories: repositories(saved),
        delivery: delivery(),
        attachment: attachment(),
        ...submissionGuard(() => revoked),
      }),
    SubmissionFencedError,
  );
  assertEquals(saved.includes("uploaded"), true);
  assertEquals(saved.some((value) => value.startsWith("finalize:")), false);
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
    ...submissionGuard(),
  });

  assertEquals(result, { entryId: 99, reviewRequired: false });
  assertEquals(calls, ["directory", "download"]);
  assertEquals(saved, ["duplicate-content", "reused-entry", "uploaded"]);
});

function source(): SourceDocumentRecord {
  return {
    id: "source-1",
    sourceSystem: "foodlogiq",
    sourceId: "document-1",
    sourceVersion: "version-1",
    readinessHash: "hash",
    documentType: "coi",
    supplierId: "supplier-1",
    supplierName: "Acme",
    status: "ready",
    payload: {
      supplier: { name: "Acme" },
      source: { documentTypeName: "COI", effectiveDate: "2026-01-01" },
    },
    provenance: {},
    approvedAt: null,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function attachment(): SourceAttachmentRecord {
  return {
    id: "attachment-1",
    sourceDocumentId: "source-1",
    sourceSystem: "foodlogiq",
    sourceId: "document-1",
    sourceVersion: "version-1",
    vdocKey: "vdoc-1",
    byteReference: "attachment-download-1",
    contentType: "application/pdf",
    fileName: "coi.pdf",
    sizeBytes: "6",
    checksum: null,
    payload: { fileName: "coi.pdf" },
    provenance: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function delivery(): DeliveryRecord {
  return {
    id: "delivery-1",
    syncRequestId: "request-1",
    sourceDocumentId: "source-1",
    sourceAttachmentId: "attachment-1",
    externalSourceDocumentId: "document-1",
    sourceVersion: "version-1",
    vdocKey: "vdoc-1",
    documentType: "coi",
    supplier: "Acme",
    idempotencyKey: "prepare-1",
    payloadHash: "payload",
    action: "create",
    status: "active",
    repository: "Repository",
    targetPath: "/trellis/trading-partners/Acme/Shared To Smithfield/COI",
    targetName: "coi.pdf",
    payload: { metadata: { Entity: "Acme" } },
    provenance: {},
    syncProvenance: null,
    result: null,
    byteLength: null,
    entryId: null,
    retryCount: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    lastRetryReason: null,
    uploadCompletedAt: null,
    approvedAt: null,
    requestedAt: new Date(),
    attemptCount: 0,
    failureCount: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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

function submissionGuard(revoked: () => boolean = () => false) {
  return {
    claimOwner: "claim-1",
    guard: async () => {
      if (revoked()) throw new SubmissionFencedError();
    },
  };
}

function cws(calls: string[] = []) {
  return {
    ensureDirectory: async (path: string) => {
      calls.push("directory");
      const entries = path.split("/").filter(Boolean).map((
        name,
        index,
        segments,
      ) => ({
        entryId: 10 + index,
        name,
        type: "Folder",
        path: `\\${segments.slice(0, index + 1).join("\\")}`,
      }));
      return { canonicalPath: path, entries };
    },
    createDocument: async () => {
      calls.push("create");
      return {
        entryId: 42,
        name: "coi.pdf",
        type: "Document",
        path: "\\coi.pdf",
      };
    },
    uploadBuffer: async () => {
      calls.push("upload");
    },
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
      persistContent: async () => {
        saved.push("content");
      },
      findExistingContent: async () => existingContent,
      persistDuplicateContent: async () => {
        saved.push("duplicate-content");
      },
      persistReusedEntryId: async () => {
        saved.push("reused-entry");
      },
      persistEntryId: async () => {
        saved.push("entry");
      },
      markUploadCompleted: async () => {
        saved.push("uploaded");
      },
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
      scheduleRetry: async () => {
        saved.push("schedule-retry");
      },
      recordFailure: async (input: { stage: string }) => {
        saved.push(`failure:${input.stage}`);
        return { id: "failure-1" };
      },
    },
  };
}
