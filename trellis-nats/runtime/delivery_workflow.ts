import type { CwsDirectory, CwsDocumentInput, CwsEntry } from "../cws.ts";
import {
  type FoodLogiQAttachmentTransferClient,
  receiveAndValidateAttachment,
} from "../domain/attachment_validation.ts";
import { CwsError } from "../cws.ts";
import { submitToCws } from "../domain/cws_submission.ts";
import {
  type DirectoryMappingStore,
  reconcileDirectory,
} from "../domain/directory_reconciliation.ts";
import { classifySubmitFailure } from "../domain/retry_policy.ts";
import { sourceFilingWorkflow } from "../domain/source_metadata.ts";
import type {
  DeliveryContentInput,
  DeliveryQueueSnapshot,
  DeliveryRecord,
  ExistingDeliveryContentRecord,
  SourceAttachmentRecord,
  SourceDocumentRecord,
} from "../db/types.ts";
import type {
  DeliveryAttemptInput,
  DeliveryInput,
  EntryMappingInput,
  FailureInput,
} from "../db/repositories.ts";
import { SubmissionFencedError } from "./submission_lease.ts";

type Repositories = {
  directories: DirectoryMappingStore;
  syncRequests: {
    finalizeFromDeliveries(id: string): Promise<unknown>;
  };
  deliveries: {
    createIdempotently(input: DeliveryInput): Promise<DeliveryRecord>;
    markActive(id: string): Promise<DeliveryRecord>;
    persistContent(input: DeliveryContentInput): Promise<void>;
    findExistingContent(
      input: Omit<DeliveryContentInput, "deliveryId">,
    ): Promise<ExistingDeliveryContentRecord | null>;
    persistDuplicateContent(input: DeliveryContentInput): Promise<void>;
    persistReusedEntryId(input: EntryMappingInput): Promise<unknown>;
    persistEntryId(input: EntryMappingInput): Promise<unknown>;
    markUploadCompleted(deliveryId: string, claimOwner?: string): Promise<void>;
    finalize(
      id: string,
      status: "review-required" | "completed" | "failed",
      result: Record<string, unknown>,
      claimOwner?: string,
    ): Promise<DeliveryRecord>;
    recordAttempt(input: DeliveryAttemptInput): Promise<unknown>;
    recordFailure(input: FailureInput): Promise<{ id: string }>;
    queueSnapshot(): Promise<DeliveryQueueSnapshot>;
    scheduleRetry(
      deliveryId: string,
      retryAt: Date,
      reason: string,
      claimOwner?: string,
    ): Promise<unknown>;
  };
};

type Cws = {
  ensureDirectory(
    path: string,
    guard?: () => Promise<void>,
  ): Promise<CwsDirectory>;
  createDocument(
    input: CwsDocumentInput,
    guard?: () => Promise<void>,
  ): Promise<CwsEntry>;
  uploadBuffer(
    entryId: number,
    extension: string,
    bytes: Uint8Array,
    guard?: () => Promise<void>,
  ): Promise<void>;
};

export async function prepareDelivery(input: {
  repositories: Repositories;
  source: SourceDocumentRecord;
  attachment: SourceAttachmentRecord;
  syncRequestId: string;
  repository: string;
  idempotencyKey: string;
  activate?: boolean;
}): Promise<DeliveryRecord> {
  const filing = sourceFilingWorkflow(
    input.source.payload as Record<string, unknown>,
    { ...input.attachment.payload, fileName: input.attachment.fileName },
    {
      sourceDocumentId: input.source.sourceId,
      sourceAttachmentKey: attachmentKey(
        input.attachment.checksum,
        input.attachment.vdocKey,
      ),
    },
  );
  const payload = {
    metadata: filing.requiredMetadata,
    sourceVersionId: input.source.sourceVersion,
    vdocKey: input.attachment.vdocKey,
  };
  const delivery = await input.repositories.deliveries.createIdempotently({
    syncRequestId: input.syncRequestId,
    sourceAttachmentId: input.attachment.id,
    idempotencyKey: input.idempotencyKey,
    payloadHash: await hash(payload),
    action: "create",
    repository: input.repository,
    targetPath: filing.canonicalPath,
    targetName: filing.targetName,
    payload,
  });
  return input.activate === false
    ? delivery
    : await input.repositories.deliveries.markActive(delivery.id);
}

export async function terminalizeEmptySourceRequest(
  syncRequests: {
    finalize(
      id: string,
      status: "failed",
      result: Record<string, unknown>,
    ): Promise<unknown>;
  },
  requestId: string,
): Promise<void> {
  await syncRequests.finalize(requestId, "failed", {
    reason: "Source document has no files",
  });
}

function attachmentKey(checksum: string | null, fallback: string): string {
  return (checksum && checksum.length >= 12
    ? checksum.slice(0, 12)
    : fallback.slice(0, 24));
}

export async function submitDelivery(input: {
  writeMode: string;
  cws: Cws;
  attachmentClient: FoodLogiQAttachmentTransferClient;
  repositories: Repositories;
  delivery: DeliveryRecord;
  attachment: SourceAttachmentRecord;
  claimOwner: string;
  guard: () => Promise<void>;
}): Promise<
  {
    entryId?: number;
    cwsName?: string;
    cwsPath?: string;
    reviewRequired: boolean;
    deferred?: boolean;
  }
> {
  if (input.writeMode !== "enabled") {
    return { reviewRequired: false, deferred: true };
  }
  const attemptNumber = input.delivery.attemptCount + 1;
  try {
    await input.guard();
    if (input.delivery.entryId && input.delivery.uploadCompletedAt) {
      await input.repositories.deliveries.recordAttempt({
        deliveryId: input.delivery.id,
        claimOwner: input.claimOwner,
        stage: "submit-cws",
        attemptNumber,
        outcome: "succeeded",
        retryable: false,
      });
      return {
        entryId: Number(input.delivery.entryId),
        reviewRequired: false,
      };
    }
    const directory = await reconcileDirectory(
      input.cws,
      input.repositories.directories,
      input.delivery.repository,
      input.delivery.targetPath,
      input.guard,
    );
    // The upload may only use a fresh, verified copy of the source attachment.
    await input.guard();
    const validation = await receiveAndValidateAttachment(
      input.attachmentClient,
      {
        attachmentId: input.attachment.byteReference,
        filename: requiredString(
          input.attachment.fileName,
          "Attachment filename is unavailable",
        ),
        declaredContentType: input.attachment.contentType,
        expectedSha256: input.attachment.checksum,
        expectedByteLength: input.attachment.sizeBytes,
      },
    );
    await input.guard();
    if (
      validation.reviewRequired || !validation.format.detected ||
      !validation.format.selectedExtension
    ) {
      const failure = await input.repositories.deliveries.recordFailure({
        deliveryId: input.delivery.id,
        claimOwner: input.claimOwner,
        syncRequestId: input.delivery.syncRequestId,
        sourceDocumentId: input.delivery.sourceDocumentId,
        stage: "validate-attachment",
        failureClass: "validation",
        reason: validation.reason ?? "Attachment requires review",
        retryable: false,
        attemptNumber,
      });
      await input.repositories.deliveries.finalize(
        input.delivery.id,
        "review-required",
        {
          failureId: failure.id,
          reason: validation.reason ?? "Attachment requires review",
          ...(validation.reviewCode
            ? { reviewCode: validation.reviewCode }
            : {}),
        },
        input.claimOwner,
      );
      await input.repositories.syncRequests.finalizeFromDeliveries(
        input.delivery.syncRequestId,
      );
      return { reviewRequired: true };
    }
    const content = {
      deliveryId: input.delivery.id,
      directoryId: directory.directoryId,
      claimOwner: input.claimOwner,
      sha256: validation.sha256,
      byteLength: validation.byteLength,
      contentType: validation.format.detected.contentType,
      uploadExtension: validation.format.selectedExtension,
    };
    const existingContent = await input.repositories.deliveries
      .findExistingContent(content);
    if (existingContent) {
      await input.guard();
      await input.repositories.deliveries.persistDuplicateContent(content);
      await input.repositories.deliveries.persistReusedEntryId({
        deliveryId: input.delivery.id,
        claimOwner: input.claimOwner,
        entryId: existingContent.entryId,
        provenance: {
          contentSha256: validation.sha256,
          duplicateOfDeliveryId: existingContent.deliveryId,
        },
      });
      await input.repositories.deliveries.markUploadCompleted(
        input.delivery.id,
        input.claimOwner,
      );
      await input.repositories.deliveries.recordAttempt({
        deliveryId: input.delivery.id,
        claimOwner: input.claimOwner,
        stage: "submit-cws",
        attemptNumber,
        outcome: "succeeded",
        retryable: false,
      });
      return {
        entryId: Number(existingContent.entryId),
        reviewRequired: false,
      };
    }
    await input.repositories.deliveries.persistContent(content);
    const submitted = await submitToCws(input.cws, {
      directoryPath: input.delivery.targetPath,
      name: input.delivery.targetName,
      contentType: validation.format.detected.contentType,
      metadata: metadata(input.delivery.payload),
      extension: validation.format.selectedExtension,
      bytes: validation.bytes,
      ...(input.delivery.entryId
        ? { existingEntryId: Number(input.delivery.entryId) }
        : {}),
      checkpointEntry: async (entry) => {
        await input.repositories.deliveries.persistEntryId({
          deliveryId: input.delivery.id,
          claimOwner: input.claimOwner,
          entryId: String(entry.entryId),
          provenance: {
            contentSha256: validation.sha256,
            cwsName: entry.name,
            cwsPath: entry.path,
          },
        });
      },
      completeUpload: async () => {
        await input.repositories.deliveries.markUploadCompleted(
          input.delivery.id,
          input.claimOwner,
        );
      },
      guard: input.guard,
    });
    await input.guard();
    await input.repositories.deliveries.recordAttempt({
      deliveryId: input.delivery.id,
      claimOwner: input.claimOwner,
      stage: "submit-cws",
      attemptNumber,
      outcome: "succeeded",
      retryable: false,
    });
    return {
      entryId: submitted.entryId,
      ...(submitted.entry
        ? { cwsName: submitted.entry.name, cwsPath: submitted.entry.path }
        : {}),
      reviewRequired: false,
    };
  } catch (error) {
    if (error instanceof SubmissionFencedError) throw error;
    await input.guard();
    const reason = "CWS submission failed";
    const retry = classifySubmitFailure(error, attemptNumber);
    const sanitizedRetry = { ...retry, reason };
    const queue = await input.repositories.deliveries.queueSnapshot().catch(
      () => ({
        unavailable: true,
        reason: "Queue snapshot unavailable",
      }),
    );
    await input.repositories.deliveries.recordFailure({
      deliveryId: input.delivery.id,
      claimOwner: input.claimOwner,
      syncRequestId: input.delivery.syncRequestId,
      sourceDocumentId: input.delivery.sourceDocumentId,
      stage: "submit-cws",
      failureClass: "unknown",
      reason,
      retryable: retry.retryable,
      attemptNumber,
      context: { queue, retry: sanitizedRetry, error: errorContext(error) },
    });
    if (retry.retryable && retry.retryAt) {
      await input.repositories.deliveries.scheduleRetry(
        input.delivery.id,
        retry.retryAt,
        reason,
        input.claimOwner,
      );
    }
    await input.repositories.deliveries.finalize(input.delivery.id, "failed", {
      reason,
      retryable: retry.retryable,
      nextAttemptAt: retry.retryAt?.toISOString(),
    }, input.claimOwner);
    await input.repositories.syncRequests.finalizeFromDeliveries(
      input.delivery.syncRequestId,
    );
    throw new Error("CWS submission failed");
  }
}

function errorContext(error: unknown): Record<string, unknown> {
  if (error instanceof CwsError) {
    return {
      name: error.name,
      operation: error.operation,
      statusCode: error.statusCode,
    };
  }
  if (error instanceof Error) {
    return { name: error.name };
  }
  return { name: "UnknownError" };
}

function metadata(
  payload: Record<string, unknown>,
): Record<string, string | string[]> {
  const value = payload.metadata;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Delivery metadata is unavailable");
  }
  return value as Record<string, string | string[]>;
}

function requiredString(value: string | null, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
