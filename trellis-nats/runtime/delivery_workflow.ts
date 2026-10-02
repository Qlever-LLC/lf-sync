import type { CwsDirectory, CwsDocumentInput, CwsEntry } from "../cws.ts";
import { receiveAndValidateAttachment, type FoodLogiQAttachmentTransferClient } from "../domain/attachment_validation.ts";
import { CwsError } from "../cws.ts";
import { submitToCws } from "../domain/cws_submission.ts";
import { reconcileDirectory, type DirectoryMappingStore } from "../domain/directory_reconciliation.ts";
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

type Repositories = {
  directories: DirectoryMappingStore;
  syncRequests: {
    finalizeFromDeliveries(id: string): Promise<unknown>;
  };
  deliveries: {
    createIdempotently(input: DeliveryInput): Promise<DeliveryRecord>;
    markActive(id: string): Promise<DeliveryRecord>;
    persistContent(input: DeliveryContentInput): Promise<void>;
    findExistingContent(input: Omit<DeliveryContentInput, "deliveryId">): Promise<ExistingDeliveryContentRecord | null>;
    persistDuplicateContent(input: DeliveryContentInput): Promise<void>;
    persistReusedEntryId(input: EntryMappingInput): Promise<unknown>;
    persistEntryId(input: EntryMappingInput): Promise<unknown>;
    finalize(id: string, status: "review-required" | "completed" | "failed", result: Record<string, unknown>): Promise<DeliveryRecord>;
    recordAttempt(input: DeliveryAttemptInput): Promise<unknown>;
    recordFailure(input: FailureInput): Promise<{ id: string }>;
    queueSnapshot(): Promise<DeliveryQueueSnapshot>;
    scheduleRetry(deliveryId: string, retryAt: Date, reason: string): Promise<unknown>;
  };
};

type Cws = {
  ensureDirectory(path: string): Promise<CwsDirectory>;
  createDocument(input: CwsDocumentInput): Promise<CwsEntry>;
  uploadBuffer(entryId: number, extension: string, bytes: Uint8Array): Promise<void>;
};

export async function prepareDelivery(input: {
  repositories: Repositories;
  source: SourceDocumentRecord;
  attachment: SourceAttachmentRecord;
  syncRequestId: string;
  repository: string;
  idempotencyKey: string;
}): Promise<DeliveryRecord> {
  const filing = sourceFilingWorkflow(
    input.source.payload as Record<string, unknown>,
    { ...input.attachment.payload, fileName: input.attachment.fileName },
    { sourceDocumentId: input.source.sourceId, sourceAttachmentKey: attachmentKey(input.attachment.checksum, input.attachment.vdocKey) },
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
  return await input.repositories.deliveries.markActive(delivery.id);
}

function attachmentKey(checksum: string | null, fallback: string): string {
  return (checksum && checksum.length >= 12 ? checksum.slice(0, 12) : fallback.slice(0, 24));
}

export async function submitDelivery(input: {
  writeMode: string;
  cws: Cws;
  attachmentClient: FoodLogiQAttachmentTransferClient;
  repositories: Repositories;
  delivery: DeliveryRecord;
  attachment: SourceAttachmentRecord;
}): Promise<{ entryId?: number; cwsName?: string; cwsPath?: string; reviewRequired: boolean }> {
  if (input.writeMode !== "enabled") {
    throw new Error("CWS writes are not permitted while LF_SYNC_WRITE_MODE is disabled");
  }
  const attemptNumber = input.delivery.attemptCount + 1;
  try {
    const directory = await reconcileDirectory(
      input.cws,
      input.repositories.directories,
      input.delivery.repository,
      input.delivery.targetPath,
    );
    // The upload may only use a fresh, verified copy of the source attachment.
    const validation = await receiveAndValidateAttachment(input.attachmentClient, {
      attachmentId: input.attachment.byteReference,
      filename: requiredString(input.attachment.fileName, "Attachment filename is unavailable"),
      declaredContentType: input.attachment.contentType,
      expectedSha256: input.attachment.checksum,
      expectedByteLength: input.attachment.sizeBytes,
    });
    if (validation.reviewRequired || !validation.format.detected || !validation.format.selectedExtension) {
      const failure = await input.repositories.deliveries.recordFailure({
        deliveryId: input.delivery.id,
        syncRequestId: input.delivery.syncRequestId,
        sourceDocumentId: input.delivery.sourceDocumentId,
        stage: "validate-attachment",
        failureClass: "validation",
        reason: validation.reason ?? "Attachment requires review",
        retryable: false,
        attemptNumber,
      });
      await input.repositories.deliveries.finalize(input.delivery.id, "review-required", {
        failureId: failure.id,
        reason: validation.reason ?? "Attachment requires review",
        ...(validation.reviewCode ? { reviewCode: validation.reviewCode } : {}),
      });
      await input.repositories.syncRequests.finalizeFromDeliveries(input.delivery.syncRequestId);
      return { reviewRequired: true };
    }
    const content = {
      deliveryId: input.delivery.id,
      directoryId: directory.directoryId,
      sha256: validation.sha256,
      byteLength: validation.byteLength,
      contentType: validation.format.detected.contentType,
      uploadExtension: validation.format.selectedExtension,
    };
    const existingContent = await input.repositories.deliveries.findExistingContent(content);
    if (existingContent) {
      await input.repositories.deliveries.persistDuplicateContent(content);
      await input.repositories.deliveries.persistReusedEntryId({
        deliveryId: input.delivery.id,
        entryId: existingContent.entryId,
        provenance: {
          contentSha256: validation.sha256,
          duplicateOfDeliveryId: existingContent.deliveryId,
        },
      });
      await input.repositories.deliveries.recordAttempt({
        deliveryId: input.delivery.id,
        stage: "submit-cws",
        attemptNumber,
        outcome: "succeeded",
        retryable: false,
      });
      return { entryId: Number(existingContent.entryId), reviewRequired: false };
    }
    await input.repositories.deliveries.persistContent(content);
    const submitted = await submitToCws(input.cws, {
      directoryPath: input.delivery.targetPath,
      name: input.delivery.targetName,
      contentType: validation.format.detected.contentType,
      metadata: metadata(input.delivery.payload),
      extension: validation.format.selectedExtension,
      bytes: validation.bytes,
      ...(input.delivery.entryId ? { existingEntryId: Number(input.delivery.entryId) } : {}),
    });
    await input.repositories.deliveries.persistEntryId({
      deliveryId: input.delivery.id,
      entryId: String(submitted.entryId),
      provenance: {
        contentSha256: validation.sha256,
        ...(submitted.entry ? { cwsName: submitted.entry.name, cwsPath: submitted.entry.path } : {}),
      },
    });
    await input.repositories.deliveries.recordAttempt({
      deliveryId: input.delivery.id,
      stage: "submit-cws",
      attemptNumber,
      outcome: "succeeded",
      retryable: false,
    });
    return {
      entryId: submitted.entryId,
      ...(submitted.entry ? { cwsName: submitted.entry.name, cwsPath: submitted.entry.path } : {}),
      reviewRequired: false,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "CWS submission failed";
    const retry = classifySubmitFailure(error, attemptNumber);
    const queue = await input.repositories.deliveries.queueSnapshot().catch((snapshotError) => ({
      unavailable: true,
      reason: snapshotError instanceof Error ? snapshotError.message : "Queue snapshot failed",
    }));
    await input.repositories.deliveries.recordFailure({
      deliveryId: input.delivery.id,
      syncRequestId: input.delivery.syncRequestId,
      sourceDocumentId: input.delivery.sourceDocumentId,
      stage: "submit-cws",
      failureClass: "unknown",
      reason,
      retryable: retry.retryable,
      attemptNumber,
      context: { queue, retry, error: errorContext(error) },
    });
    if (retry.retryable && retry.retryAt) {
      await input.repositories.deliveries.scheduleRetry(input.delivery.id, retry.retryAt, reason);
    }
    await input.repositories.deliveries.finalize(input.delivery.id, "failed", {
      reason,
      retryable: retry.retryable,
      nextAttemptAt: retry.retryAt?.toISOString(),
    });
    await input.repositories.syncRequests.finalizeFromDeliveries(input.delivery.syncRequestId);
    throw new Error("CWS submission failed", { cause: error });
  }
}

function errorContext(error: unknown): Record<string, unknown> {
  if (error instanceof CwsError) {
    return {
      name: error.name,
      message: error.message,
      operation: error.operation,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function metadata(payload: Record<string, unknown>): Record<string, string | string[]> {
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
