import { Result, UnexpectedError } from "@qlever-llc/trellis";
import {
  type ConnectedTrellisService,
  TrellisService,
} from "@qlever-llc/trellis/service/deno";
import type { Config } from "../config.ts";
import contract from "../contracts/lf_sync.ts";
import {
  createRepositories,
  type Database,
  type QueryExecutor,
} from "../db/mod.ts";
import { CwsAdapter } from "../cws.ts";
import {
  prepareDelivery,
  submitDelivery,
  terminalizeEmptySourceRequest,
} from "./delivery_workflow.ts";
import {
  startSubmissionLease,
  SubmissionFencedError,
  submissionLeaseUntil,
} from "./submission_lease.ts";

type Runtime = {
  service: ConnectedTrellisService<typeof contract>;
  outbox: {
    transaction<TResult>(
      work: (context: { tx: QueryExecutor; job: any }) => Promise<TResult>,
    ): { orThrow(): Promise<TResult> };
  };
  database: Database;
  config: Config;
};

const SOURCE_SYSTEM = "foodlogiq";
const SOURCE_CONSUMER = "sourceDocuments";
const RETRY_INTERVAL_MS = 30_000;
const RETRY_BATCH_SIZE = 25;
const STALE_ACTIVE_MS = 2 * 60 * 60 * 1000;

export async function registerRuntime(runtime: Runtime): Promise<void> {
  const { service } = runtime;
  await registerRpc(runtime);
  await registerOperations(service);
  registerJobs(runtime);
  startDeliveryRetryLoop(runtime);
  await service.onDocumentsReadyForLaserfiche(async ({ event, context }) => {
    try {
      await receiveReadyEvent(runtime, event, context);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        unexpectedError(error, "source event ingestion failed"),
      );
    }
  });
  await service.onDocumentsApprovalRevoked(async ({ event, context }) => {
    try {
      await receiveRevocation(runtime, event, context);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        unexpectedError(error, "source revocation ingestion failed"),
      );
    }
  });
}

function startDeliveryRetryLoop(runtime: Runtime): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await retryDueDeliveries(runtime);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Delivery retry loop failed",
        error: sanitizedError(error),
      }));
    } finally {
      running = false;
    }
  };
  setInterval(tick, RETRY_INTERVAL_MS);
  queueMicrotask(() => void tick());
}

async function retryDueDeliveries(runtime: Runtime): Promise<void> {
  if (runtime.config.writeMode !== "enabled") return;
  const repositories = createRepositories(runtime.database);
  const pending = await repositories.deliveries.listPendingForActivation(
    RETRY_BATCH_SIZE,
  );
  const due = await repositories.deliveries.listDueRetries(RETRY_BATCH_SIZE);
  const remaining = Math.max(
    0,
    RETRY_BATCH_SIZE - due.length - pending.length,
  );
  const stale = remaining === 0
    ? []
    : await repositories.deliveries.listStaleActiveForRetry(
      new Date(Date.now() - STALE_ACTIVE_MS),
      remaining,
    );
  if (pending.length === 0 && due.length === 0 && stale.length === 0) return;
  console.info(JSON.stringify({
    level: "info",
    message: "Retrying Laserfiche deliveries",
    pendingActivationCount: pending.length,
    retryDueCount: due.length,
    staleActiveCount: stale.length,
  }));
  for (const delivery of pending) {
    try {
      await runtime.service.jobs.submitLaserfiche.create({
        correlationId: `activate:${delivery.id}`,
        sourceDocumentId: delivery.sourceDocumentId,
        deliveryId: delivery.id,
        vdocKey: delivery.vdocKey,
        idempotencyKey: `submit:activate:${delivery.id}`,
      }).orThrow();
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Failed to activate shadow Laserfiche delivery",
        deliveryId: delivery.id,
        error: sanitizedError(error),
      }));
    }
  }
  for (const delivery of due) {
    try {
      const retrying = await repositories.deliveries.markRetrying(delivery.id);
      const resolvedFailures = await repositories.deliveries
        .resolveOpenFailuresForRetry(delivery.id, {
          automaticRetry: {
            queuedAt: new Date().toISOString(),
            retryCount: retrying.retryCount,
          },
        });
      await runtime.service.jobs.submitLaserfiche.create({
        correlationId: `auto-retry:${delivery.id}:${Date.now()}`,
        sourceDocumentId: delivery.sourceDocumentId,
        deliveryId: delivery.id,
        vdocKey: delivery.vdocKey,
        idempotencyKey:
          `submit:auto-retry:${delivery.id}:${retrying.retryCount}`,
      }).orThrow();
      console.info(JSON.stringify({
        level: "info",
        message: "Queued Laserfiche delivery retry",
        deliveryId: delivery.id,
        retryCount: retrying.retryCount,
        resolvedFailures,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Failed to queue Laserfiche delivery retry",
        deliveryId: delivery.id,
        error: sanitizedError(error),
      }));
    }
  }
  for (const delivery of stale) {
    try {
      const retrying = await repositories.deliveries.markStaleActiveRetrying(
        delivery.id,
        new Date(Date.now() - STALE_ACTIVE_MS),
      );
      await runtime.service.jobs.submitLaserfiche.create({
        correlationId: `stale-active:${delivery.id}:${Date.now()}`,
        sourceDocumentId: delivery.sourceDocumentId,
        deliveryId: delivery.id,
        vdocKey: delivery.vdocKey,
        idempotencyKey:
          `submit:stale-active:${delivery.id}:${retrying.retryCount}`,
      }).orThrow();
      console.info(JSON.stringify({
        level: "info",
        message: "Queued stale active Laserfiche delivery",
        deliveryId: delivery.id,
        retryCount: retrying.retryCount,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Failed to queue stale active Laserfiche delivery",
        deliveryId: delivery.id,
        error: sanitizedError(error),
      }));
    }
  }
}

async function receiveReadyEvent(
  runtime: Runtime,
  event: Record<string, unknown>,
  context: unknown,
): Promise<void> {
  const eventId = eventIdentity(event, context);
  await runtime.outbox.transaction(async ({ tx, job }) => {
    const repositories = createRepositories(tx);
    const receipt = await repositories.inbox.receive({
      consumer: SOURCE_CONSUMER,
      eventId,
      eventType: "Documents.ReadyForLaserfiche",
      payload: event,
    });
    if (!receipt.inserted) return;
    const sourceId = required(event, "sourceDocumentId");
    const sourceVersion = required(event, "sourceVersionId");
    await repositories.sources.lockApprovalVersion(
      SOURCE_SYSTEM,
      sourceId,
      sourceVersion,
    );
    const supplier = object(object(event, "filing"), "supplier");
    await repositories.sources.upsertCanonicalSource({
      sourceSystem: SOURCE_SYSTEM,
      sourceId,
      sourceVersion,
      readinessHash: required(
        object(event, "archiveReadiness"),
        "readinessHash",
      ),
      documentType: required(event, "documentTypeKey"),
      supplierId: required(supplier, "id"),
      supplierName: required(supplier, "name"),
      status: "ready",
      payload: event,
      approvedAt: dateFrom(object(event, "approval").changedAt),
      sourceUpdatedAt: dateFrom(event.occurredAt),
    });
    for (const attachment of array(event, "attachments")) {
      await repositories.sources.upsertAttachment({
        sourceSystem: SOURCE_SYSTEM,
        sourceId,
        sourceVersion,
        vdocKey: required(attachment, "attachmentId"),
        byteReference: required(attachment, "attachmentId"),
        contentType: optional(attachment, "contentType") ??
          "application/octet-stream",
        fileName: required(attachment, "fileName"),
        sizeBytes: numberAsString(attachment, "byteLength"),
        checksum: required(attachment, "sha256"),
        payload: attachment,
      });
    }
    if (
      await repositories.sources.isApprovalRevoked(
        SOURCE_SYSTEM,
        sourceId,
        sourceVersion,
      )
    ) {
      await repositories.inbox.completeRecorded(receipt.record.id);
      return;
    }
    await job.processSourceEvent.submit({
      correlationId: eventId,
      sourceEventId: eventId,
      sourceEventName: "Documents.ReadyForLaserfiche",
      sourceDocumentId: sourceId,
      sourceVersionId: sourceVersion,
      approvalId: required(
        object(event, "archiveReadiness"),
        "approvalConfirmationId",
      ),
      documentTypeKey: required(event, "documentTypeKey"),
      occurredAt: required(event, "occurredAt"),
      idempotencyKey: `source-event:${eventId}`,
    }).orThrow();
    await repositories.inbox.completeRecorded(receipt.record.id);
  }).orThrow();
}

async function receiveRevocation(
  runtime: Runtime,
  event: Record<string, unknown>,
  context: unknown,
): Promise<void> {
  const eventId = eventIdentity(event, context);
  await runtime.outbox.transaction(async ({ tx }) => {
    const repositories = createRepositories(tx);
    const receipt = await repositories.inbox.receive({
      consumer: SOURCE_CONSUMER,
      eventId,
      eventType: "Documents.ApprovalRevoked",
      payload: event,
    });
    if (!receipt.inserted) return;
    const sourceId = required(event, "sourceDocumentId");
    const sourceVersion = required(event, "sourceVersionId");
    await repositories.sources.lockApprovalVersion(
      SOURCE_SYSTEM,
      sourceId,
      sourceVersion,
    );
    await repositories.sources.recordApprovalRevocation({
      sourceSystem: SOURCE_SYSTEM,
      sourceId,
      sourceVersion,
      eventId,
      reason: "source approval revoked",
      revokedAt: dateFrom(event.occurredAt) ?? undefined,
      provenance: { eventType: "Documents.ApprovalRevoked" },
    });
    await repositories.deliveries.markApprovalRevoked({
      sourceSystem: SOURCE_SYSTEM,
      sourceId,
      sourceVersion,
      result: { reason: "source approval revoked", revocationEventId: eventId },
    });
    await repositories.inbox.completeRecorded(receipt.record.id);
  }).orThrow();
}

function registerJobs(runtime: Runtime): void {
  const { service } = runtime;
  service.jobs.processSourceEvent.handle(async ({ job }) => {
    try {
      const payload = job.payload;
      if (payload.sourceEventName === "Documents.ApprovalRevoked") {
        return Result.ok({
          correlationId: payload.correlationId,
          disposition: "ignored",
          reason: "approval revoked",
        });
      }
      await runtime.outbox.transaction(async ({ tx, job: outboxJob }) => {
        const repositories = createRepositories(tx);
        const source = await repositories.sources.getBySource(
          SOURCE_SYSTEM,
          payload.sourceDocumentId,
          payload.sourceVersionId,
        );
        if (!source) throw new Error("Source document is unavailable");
        await repositories.sources.lockApprovalVersion(
          source.sourceSystem,
          source.sourceId,
          source.sourceVersion,
        );
        if (
          await repositories.sources.isApprovalRevoked(
            source.sourceSystem,
            source.sourceId,
            source.sourceVersion,
          )
        ) return;
        const attachments = await repositories.sources.listAttachments(
          source.id,
        );
        if (attachments.length === 0) {
          throw new Error("Ready source event did not retain attachments");
        }
        const requestedVdocKeys = expectedVdocKeys(attachments);
        const request = await repositories.syncRequests.createRequest({
          sourceDocumentId: source.id,
          requestKey: `source-event:${payload.sourceEventId}`,
          requestedBy: "foodlogiq",
          reason: "approved",
          requestedVdocKeys,
          provenance: { correlationId: payload.correlationId },
        });
        for (const attachment of attachments) {
          await outboxJob.prepareDelivery.submit({
            correlationId: payload.correlationId,
            sourceDocumentId: payload.sourceDocumentId,
            sourceVersionId: payload.sourceVersionId,
            vdocKey: attachment.vdocKey,
            idempotencyKey: `prepare:${payload.sourceDocumentId}:${
              payload.sourceVersionId ?? "current"
            }:${attachment.vdocKey}`,
          }).orThrow();
        }
        await repositories.syncRequests.markActive(request.id);
      }).orThrow();
      return Result.ok({
        correlationId: payload.correlationId,
        disposition: "accepted",
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "processSourceEvent job failed",
        error: error instanceof Error ? error.message : "unknown error",
        cause: error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : undefined,
      }));
      return Result.err(unexpectedError(error, "processSourceEvent failed"));
    }
  });
  service.jobs.loadSourceDocument.handle(async ({ job, client }) => {
    try {
      const payload = job.payload;
      if (
        payload.sourceVersionId &&
        await createRepositories(runtime.database).sources.isApprovalRevoked(
          SOURCE_SYSTEM,
          payload.sourceDocumentId,
          payload.sourceVersionId,
        )
      ) {
        return Result.ok({
          loaded: false,
          sourceDocumentId: payload.sourceDocumentId,
          documentTypeKey: payload.documentTypeKey,
          vdocCount: 0,
          fileCount: 0,
        });
      }
      const documentResult = await client.documentsGet({
        documentId: payload.sourceDocumentId,
      }).orThrow();
      const document = documentResult.document as Record<string, unknown>;
      const currentVersion = optional(document, "foodLogiQCurrentVersionId");
      if (
        payload.sourceVersionId && currentVersion &&
        currentVersion !== payload.sourceVersionId
      ) {
        throw new Error(
          "FoodLogiQ returned a newer version than the approved event",
        );
      }
      const sourceVersion = optional(document, "foodLogiqCurrentVersionId") ??
        payload.sourceVersionId ?? "current";
      const filesResult = await client.documentsFilesList({
        documentId: payload.sourceDocumentId,
        ...(sourceVersion !== "current"
          ? { documentVersionId: sourceVersion }
          : {}),
      }).orThrow();
      const retained = await runtime.outbox.transaction(
        async ({ tx, job: outboxJob }) => {
          const repositories = createRepositories(tx);
          await repositories.sources.lockApprovalVersion(
            SOURCE_SYSTEM,
            payload.sourceDocumentId,
            sourceVersion,
          );
          const source = await repositories.sources.upsertCanonicalSource({
            sourceSystem: SOURCE_SYSTEM,
            sourceId: payload.sourceDocumentId,
            sourceVersion,
            readinessHash: required(document, "sourceHash"),
            documentType: optional(document, "documentTypeKey") ??
              payload.documentTypeKey,
            supplierId: optional(document, "foodLogiqBusinessId") ?? null,
            supplierName: optional(objectOrEmpty(document.supplier), "name") ??
              null,
            status: "ready",
            payload: document,
            sourceUpdatedAt: dateFrom(document.updatedAt),
          });
          if (
            await repositories.sources.isApprovalRevoked(
              source.sourceSystem,
              source.sourceId,
              source.sourceVersion,
            )
          ) return false;
          const attachments = [];
          for (const file of filesResult.entries as Record<string, unknown>[]) {
            attachments.push(
              await repositories.sources.upsertAttachment({
                sourceSystem: SOURCE_SYSTEM,
                sourceId: payload.sourceDocumentId,
                sourceVersion,
                vdocKey: required(file, "attachmentKey"),
                byteReference: required(file, "id"),
                contentType: optional(file, "contentType") ??
                  "application/octet-stream",
                fileName: optional(file, "fileName"),
                sizeBytes: numberAsString(file, "byteLength"),
                checksum: optional(file, "sha256"),
                payload: file,
              }),
            );
          }
          const request = await repositories.syncRequests.createRequest({
            sourceDocumentId: source.id,
            requestKey: `source-event:${payload.correlationId}`,
            requestedBy: "foodlogiq",
            reason: "approved",
            requestedVdocKeys: expectedVdocKeys(attachments),
            provenance: { correlationId: payload.correlationId },
          });
          if (attachments.length === 0) {
            await terminalizeEmptySourceRequest(
              repositories.syncRequests,
              request.id,
            );
            return true;
          }
          for (const attachment of attachments) {
            await outboxJob.prepareDelivery.submit({
              correlationId: payload.correlationId,
              sourceDocumentId: payload.sourceDocumentId,
              sourceVersionId: sourceVersion,
              vdocKey: attachment.vdocKey,
              idempotencyKey:
                `prepare:${payload.sourceDocumentId}:${sourceVersion}:${attachment.vdocKey}`,
            }).orThrow();
          }
          await repositories.syncRequests.markActive(request.id);
          return true;
        },
      ).orThrow();
      return Result.ok({
        loaded: retained && filesResult.entries.length > 0,
        sourceDocumentId: payload.sourceDocumentId,
        documentTypeKey: payload.documentTypeKey,
        vdocCount: filesResult.entries.length,
        fileCount: filesResult.entries.length,
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "loadSourceDocument job failed",
        error: error instanceof Error ? error.message : "unknown error",
        cause: error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : undefined,
      }));
      return Result.err(unexpectedError(error, "loadSourceDocument failed"));
    }
  });
  service.jobs.prepareDelivery.handle(async ({ job }) => {
    try {
      const payload = job.payload;
      const result = await runtime.outbox.transaction(
        async ({ tx, job: outboxJob }) => {
          const repositories = createRepositories(tx);
          const source = await repositories.sources.getBySource(
            SOURCE_SYSTEM,
            payload.sourceDocumentId,
            payload.sourceVersionId,
          );
          if (!source) throw new Error("Source document is unavailable");
          await repositories.sources.lockApprovalVersion(
            source.sourceSystem,
            source.sourceId,
            source.sourceVersion,
          );
          if (
            await repositories.sources.isApprovalRevoked(
              source.sourceSystem,
              source.sourceId,
              source.sourceVersion,
            )
          ) return null;
          const attachment = await repositories.sources.getAttachment(
            source.id,
            payload.vdocKey,
          );
          if (!attachment) throw new Error("Source attachment is unavailable");
          const request = await repositories.syncRequests.createRequest({
            sourceDocumentId: source.id,
            requestKey: `source-event:${payload.correlationId}`,
            requestedBy: SOURCE_SYSTEM,
            reason: "approved",
            requestedVdocKeys: expectedVdocKeys(
              await repositories.sources.listAttachments(source.id),
            ),
            provenance: { correlationId: payload.correlationId },
          });
          const delivery = await prepareDelivery({
            repositories,
            source,
            attachment,
            syncRequestId: request.id,
            repository: requiredConfig(
              runtime.config.cwsRepo,
              "CWS_REPO is required",
            ),
            idempotencyKey: payload.idempotencyKey,
            activate: runtime.config.writeMode === "enabled",
          });
          if (runtime.config.writeMode === "enabled") {
            await outboxJob.submitLaserfiche.submit({
              correlationId: payload.correlationId,
              sourceDocumentId: payload.sourceDocumentId,
              deliveryId: delivery.id,
              vdocKey: payload.vdocKey,
              idempotencyKey: `submit:${delivery.id}`,
            }).orThrow();
          }
          return delivery;
        },
      ).orThrow();
      if (!result) return Result.ok({ prepared: false });
      return Result.ok({
        deliveryId: result.id,
        prepared: true,
        targetPath: result.targetPath,
        targetName: result.targetName,
      });
    } catch (error) {
      return Result.err(unexpectedError(error, "prepareDelivery failed"));
    }
  });
  service.jobs.submitLaserfiche.handle(async ({ job }) => {
    const payload = job.payload;
    try {
      const repositories = createRepositories(runtime.database);
      const details = await repositories.deliveries.getDelivery(
        payload.deliveryId,
      );
      if (!details) throw new Error("Delivery is unavailable");
      if (runtime.config.writeMode !== "enabled") {
        await repositories.deliveries.deferSubmission(payload.deliveryId);
        return Result.ok({ deferred: true });
      }
      if (
        details.delivery.status === "completed" && details.delivery.entryId
      ) {
        return Result.ok({
          laserficheEntryId: Number(details.delivery.entryId),
        });
      }
      if (
        await repositories.sources.isApprovalRevoked(
          SOURCE_SYSTEM,
          details.delivery.externalSourceDocumentId,
          details.delivery.sourceVersion,
        )
      ) return Result.ok({ revoked: true });
      const claimOwner = `${payload.idempotencyKey}:${crypto.randomUUID()}`;
      const claimed = await repositories.deliveries.claimForSubmission(
        payload.deliveryId,
        claimOwner,
        submissionLeaseUntil(),
      );
      if (!claimed) {
        return Result.ok({ deferred: true });
      }
      const lease = startSubmissionLease({
        deliveryId: payload.deliveryId,
        claimOwner,
        renew: (deliveryId, owner, leaseUntil) =>
          repositories.deliveries.renewSubmissionClaim(
            deliveryId,
            owner,
            leaseUntil,
          ),
      });
      try {
        const attachment = await repositories.sources.getAttachmentById(
          claimed.sourceAttachmentId,
        );
        if (!attachment) throw new Error("Source attachment is unavailable");
        const attachmentClient = await TrellisService.connect({
          trellisUrl: runtime.config.trellisUrl,
          contract,
          name:
            `${runtime.config.serviceName}-attachment-${payload.deliveryId}-${Date.now()}`,
          sessionKeySeed: requiredConfig(
            runtime.config.sessionKeySeed,
            "TRELLIS_SESSION_KEY_SEED is required",
          ),
        }).orThrow();
        let submitted;
        try {
          submitted = await submitDelivery({
            writeMode: runtime.config.writeMode,
            cws: new CwsAdapter(runtime.config),
            attachmentClient,
            repositories,
            delivery: claimed,
            attachment,
            claimOwner,
            guard: lease.guard,
          });
        } finally {
          await attachmentClient.stop();
        }
        if (submitted.reviewRequired || submitted.entryId === undefined) {
          return Result.err(noWriteError("Attachment requires review"));
        }
        await lease.guard();
        await repositories.deliveries.finalize(
          payload.deliveryId,
          "completed",
          {
            laserficheEntryId: submitted.entryId,
            ...(submitted.cwsName ? { laserficheName: submitted.cwsName } : {}),
            ...(submitted.cwsPath ? { laserfichePath: submitted.cwsPath } : {}),
          },
          claimOwner,
        );
        await repositories.syncRequests.finalizeFromDeliveries(
          claimed.syncRequestId,
        );
        await runtime.outbox.transaction(async ({ job: outboxJob }) => {
          await outboxJob.finalizeDelivery.submit({
            correlationId: payload.correlationId,
            sourceDocumentId: payload.sourceDocumentId,
            deliveryId: payload.deliveryId,
            vdocKey: payload.vdocKey,
            idempotencyKey: `finalize:${payload.deliveryId}`,
          }).orThrow();
        }).orThrow();
        return Result.ok({ laserficheEntryId: submitted.entryId });
      } finally {
        await lease.stop();
        await repositories.deliveries.releaseSubmissionClaim(
          payload.deliveryId,
          claimOwner,
        );
      }
    } catch (error) {
      if (error instanceof SubmissionFencedError) {
        const details = await createRepositories(runtime.database).deliveries
          .getDelivery(payload.deliveryId);
        return Result.ok(
          details?.delivery.status === "approval-revoked"
            ? { revoked: true }
            : { deferred: true },
        );
      }
      return Result.err(unexpectedError(error, "submitLaserfiche failed"));
    }
  });
  service.jobs.finalizeDelivery.handle(async ({ job }) => {
    try {
      const payload = job.payload;
      const result = await runtime.outbox.transaction(async ({ tx }) => {
        const repositories = createRepositories(tx);
        const details = await repositories.deliveries.getDelivery(
          payload.deliveryId,
        );
        if (!details) throw new Error("Delivery is unavailable");
        const status = details.delivery.status === "active" ||
            details.delivery.status === "pending"
          ? "completed"
          : details.delivery.status;
        const delivery = await repositories.deliveries.finalize(
          payload.deliveryId,
          status,
          {
            ...(details.delivery.entryId
              ? { laserficheEntryId: details.delivery.entryId }
              : {}),
          },
        );
        await repositories.syncRequests.finalizeFromDeliveries(
          delivery.syncRequestId,
        );
        return delivery;
      }).orThrow();
      return Result.ok({
        deliveryId: result.id,
        status: result.status as
          | "completed"
          | "partial"
          | "failed"
          | "review-required"
          | "approval-revoked",
        lifecycleEventId: `delivery:${result.id}`,
      });
    } catch (error) {
      return Result.err(unexpectedError(error, "finalizeDelivery failed"));
    }
  });
  service.jobs.processBackfillPage.handle(async () =>
    Result.err(
      noWriteError("processBackfillPage is disabled in the no-write runtime"),
    )
  );
  service.jobs.generateReport.handle(async () =>
    Result.err(
      noWriteError("generateReport is disabled in the no-write runtime"),
    )
  );
}

async function registerOperations(service: Runtime["service"]): Promise<void> {
  await service.handleReportsGenerate(async () => {
    throw noWriteError("Reports.Generate is disabled in the no-write runtime");
  });
  await service.handleDocumentsSync(async () => {
    throw noWriteError("Documents.Sync is disabled in the no-write runtime");
  });
  await service.handleFailuresReplay(async () => {
    throw noWriteError("Failures.Replay is disabled in the no-write runtime");
  });
  await service.handleBackfillsRun(async () => {
    throw noWriteError("Backfills.Run is disabled in the no-write runtime");
  });
}

async function registerRpc(runtime: Runtime): Promise<void> {
  const { service } = runtime;
  await service.handleDashboardSummary(async ({ input }) => {
    const summary = await createRepositories(runtime.database).deliveries
      .dashboardSummary(filters(input.filter));
    return Result.ok({
      generatedAt: new Date().toISOString(),
      sourceDocuments: summary.sourceDocuments,
      documentsDelivered: summary.documentsDelivered,
      ...(summary.documentBytesDelivered === null
        ? {}
        : { documentBytesDelivered: summary.documentBytesDelivered }),
      completionTrend: summary.completionTrend,
      deliveriesPending: summary.deliveriesPending,
      deliveriesActive: summary.deliveriesActive,
      deliveriesCompleted: summary.deliveriesCompleted,
      deliveriesPartial: summary.deliveriesPartial,
      deliveriesFailed: summary.deliveriesFailed,
      deliveriesReviewRequired: summary.deliveriesReviewRequired,
      deliveriesApprovalRevoked: summary.deliveriesApprovalRevoked,
      openFailures: summary.openFailures,
      inboxBacklog: summary.inboxBacklog,
      outboxBacklog: summary.outboxBacklog,
    });
  });
  await service.handleDeliveriesList(async ({ input }) => {
    const page = await createRepositories(runtime.database).deliveries
      .listDeliveries({
        ...filters(input.filter),
        limit: input.pagination?.limit,
        cursor: parseCursor(input.pagination?.cursor),
      });
    return Result.ok({
      items: page.items.map(delivery),
      page: pageInfo(page.nextCursor),
    });
  });
  await service.handleDeliveriesGet(async ({ input }) => {
    const details = await createRepositories(runtime.database).deliveries
      .getDelivery(input.deliveryId);
    if (!details) return Result.err(noWriteError("Delivery not found"));
    return Result.ok({
      delivery: delivery(details.delivery),
      failures: details.failures.map(failureSummary),
    });
  });
  await service.handleDocumentsStatus(async ({ input }) => {
    const status = await createRepositories(runtime.database).deliveries
      .getDocumentStatus(input.sourceDocumentId, input.vdocKey);
    return Result.ok({
      sourceDocumentId: status.sourceDocumentId,
      status: status.status,
      ...(status.updatedAt
        ? { updatedAt: status.updatedAt.toISOString() }
        : {}),
      deliveries: status.deliveries.map(delivery),
      failures: status.failures.map(failureSummary),
    });
  });
  await service.handleFailuresList(async ({ input }) => {
    const page = await createRepositories(runtime.database).deliveries
      .listFailures({
        ...filters(input.filter),
        limit: input.pagination?.limit,
        cursor: parseCursor(input.pagination?.cursor),
      });
    return Result.ok({
      items: page.items.map(failureSummary),
      page: pageInfo(page.nextCursor),
    });
  });
  await service.handleFailuresSummary(async () => {
    const summary = await createRepositories(runtime.database).deliveries
      .failureSummary();
    return Result.ok(summary);
  });
  await service.handleFailuresTypes(async ({ input }) => {
    const items = await createRepositories(runtime.database).deliveries
      .failureTypeSummary(input.limit);
    return Result.ok({
      items: items.map((item) => ({
        ...item,
        latestOccurredAt: cursorTimestamp(item.latestOccurredAt),
      })),
    });
  });
  await service.handleFailuresGet(async ({ input }) => {
    const record = await createRepositories(runtime.database).deliveries
      .getFailure(input.failureId);
    if (!record) return Result.err(noWriteError("Failure not found"));
    return Result.ok({
      failure: {
        ...failureSummary(record),
        correlationId: record.syncRequestId ?? record.id,
        context: record.context,
        provenance: record.provenance,
      },
    });
  });
  await service.handleReportsList(async ({ input }) => {
    const page = await createRepositories(runtime.database).reports.list({
      ...filters(input.filter),
      limit: input.pagination?.limit,
      cursor: parseCursor(input.pagination?.cursor),
    });
    return Result.ok({
      items: page.items.map(report),
      page: pageInfo(page.nextCursor),
    });
  });
  await service.handleReportsGet(async ({ input }) => {
    const record = await createRepositories(runtime.database).reports.get(
      input.reportId,
    );
    if (!record) return Result.err(noWriteError("Report not found"));
    return Result.ok({ report: report(record) });
  });
  await service.handleReportsDownload(async ({ input, context }) => {
    const record = await createRepositories(runtime.database).reports.get(
      input.reportId,
    );
    const objectKey = optional(objectOrEmpty(record?.result), "objectKey");
    if (record?.status !== "completed" || !objectKey) {
      return Result.err(noWriteError("Completed report object is unavailable"));
    }
    const transfer = await service.createTransfer({
      direction: "receive",
      store: "migrationObjects",
      key: objectKey,
      sessionKey: context.sessionKey,
    }).orThrow();
    return Result.ok({ transfer });
  });
}

function delivery(record: Record<string, unknown>) {
  return {
    deliveryId: String(record.id),
    correlationId: String(record.syncRequestId),
    sourceDocumentId: String(record.externalSourceDocumentId),
    ...(record.foodlogiqAttachmentId
      ? { sourceAttachmentId: String(record.foodlogiqAttachmentId) }
      : {}),
    ...(record.sourceVersion
      ? { sourceVersionId: String(record.sourceVersion) }
      : {}),
    vdocKey: String(record.vdocKey),
    status: deliveryStatus(record.status),
    documentType: String(record.documentType ?? "unknown"),
    documentName: String(record.targetName),
    ...(record.supplier ? { supplier: String(record.supplier) } : {}),
    approvedAt: date(record.approvedAt),
    requestedAt: date(record.requestedAt),
    updatedAt: date(record.updatedAt),
    ...(record.finishedAt ? { completedAt: date(record.finishedAt) } : {}),
    ...(record.entryId ? { laserficheEntryId: Number(record.entryId) } : {}),
    targetPath: String(record.targetPath),
    targetName: String(record.targetName),
    ...(record.byteLength ? { byteLength: String(record.byteLength) } : {}),
    ...reviewClassification(record.result),
    ...syncProvenance(record.syncProvenance),
    metadata: deliveryMetadata(record.payload),
    attempt: Number(record.attemptCount),
    failureCount: Number(record.failureCount),
  };
}

function reviewClassification(
  value: unknown,
): { reviewCode?: string; reviewReason?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.reviewCode === "string" && record.reviewCode.trim()
      ? { reviewCode: record.reviewCode }
      : {}),
    ...(typeof record.reason === "string" && record.reason.trim()
      ? { reviewReason: record.reason }
      : {}),
  };
}

function syncProvenance(value: unknown): {
  syncProvenance?: {
    source: string;
    runId?: string;
    scriptName?: string;
    pollWindowFrom?: string;
    pollWindowTo?: string;
    publishedAt?: string;
  };
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const source = record.source;
  if (typeof source !== "string" || !source.trim()) return {};
  return {
    syncProvenance: {
      source,
      ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
      ...(typeof record.scriptName === "string"
        ? { scriptName: record.scriptName }
        : {}),
      ...(typeof record.pollWindowFrom === "string"
        ? { pollWindowFrom: record.pollWindowFrom }
        : {}),
      ...(typeof record.pollWindowTo === "string"
        ? { pollWindowTo: record.pollWindowTo }
        : {}),
      ...(typeof record.publishedAt === "string"
        ? { publishedAt: record.publishedAt }
        : {}),
    },
  };
}

function deliveryMetadata(
  payload: unknown,
): Record<string, string | string[]> | undefined {
  const metadata = objectOrEmpty(objectOrEmpty(payload).metadata);
  const entries: Array<[string, string | string[]]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      entries.push([key, value]);
      continue;
    }
    if (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    ) {
      entries.push([key, value]);
    }
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function failureSummary(record: Record<string, unknown>) {
  return {
    failureId: String(record.id),
    ...(record.externalSourceDocumentId ?? record.sourceDocumentId
      ? {
        sourceDocumentId: String(
          record.externalSourceDocumentId ?? record.sourceDocumentId,
        ),
      }
      : {}),
    ...(record.deliveryId ? { deliveryId: String(record.deliveryId) } : {}),
    ...(record.vdocKey ? { vdocKey: String(record.vdocKey) } : {}),
    ...(record.documentType
      ? { documentType: String(record.documentType) }
      : {}),
    ...(record.supplier ? { supplier: String(record.supplier) } : {}),
    ...(record.targetPath ? { targetPath: String(record.targetPath) } : {}),
    status: failureStatus(record.status),
    stage: String(record.stage),
    failureClass: failureClass(record.failureClass),
    reason: String(record.reason),
    retryable: Boolean(record.retryable),
    ...(record.attemptNumber ? { attempt: Number(record.attemptNumber) } : {}),
    ...(record.maxAttempts ? { maxAttempts: Number(record.maxAttempts) } : {}),
    occurredAt: date(record.occurredAt),
    updatedAt: date(record.updatedAt),
  };
}
function report(record: Record<string, unknown>) {
  const result = objectOrEmpty(record.result);
  return {
    reportId: String(record.id),
    reportType: reportType(record.reportType),
    format: reportFormat(optional(result, "format")),
    status: reportStatus(record.status),
    requestedBy: String(record.requestedBy ?? "system"),
    requestedAt: date(record.createdAt),
    ...(record.finishedAt ? { completedAt: date(record.finishedAt) } : {}),
    ...(typeof result.rowCount === "number"
      ? { rowCount: result.rowCount }
      : {}),
    ...(typeof result.fileName === "string"
      ? { fileName: result.fileName }
      : {}),
    ...(record.error ? { failureReason: "Report generation failed" } : {}),
  };
}
function pageInfo(cursor: { createdAt: Date | string; id: string } | null) {
  return {
    hasMore: cursor !== null,
    ...(cursor
      ? { nextCursor: `${cursorTimestamp(cursor.createdAt)}|${cursor.id}` }
      : {}),
  };
}
function cursorTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
function parseCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  const [createdAt, id] = cursor.split("|");
  return createdAt && id ? { createdAt: new Date(createdAt), id } : undefined;
}
function filters(value: unknown) {
  const filter = objectOrEmpty(value);
  return {
    ...filter,
    approvedAt: dateRange(filter.approvedAt),
    updatedAt: dateRange(filter.updatedAt),
    occurredAt: dateRange(filter.occurredAt),
  };
}
function dateRange(value: unknown) {
  const range = objectOrEmpty(value);
  return Object.keys(range).length
    ? {
      ...(typeof range.from === "string" ? { from: new Date(range.from) } : {}),
      ...(typeof range.to === "string" ? { to: new Date(range.to) } : {}),
    }
    : undefined;
}
function eventIdentity(
  event: Record<string, unknown>,
  context: unknown,
): string {
  const candidate = objectOrEmpty(context).eventId ?? objectOrEmpty(context).id;
  return typeof candidate === "string"
    ? candidate
    : `${required(event, "sourceDocumentId")}:${
      required(event, "sourceVersionId")
    }:${required(event, "occurredAt")}`;
}
function required(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    throw new Error("Invalid source event");
  }
  return item;
}
function requiredConfig(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}
function optional(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}
function numberAsString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === "number" && Number.isSafeInteger(item) && item >= 0
    ? String(item)
    : undefined;
}
function object(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const item = value[key];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Invalid source event");
  }
  return item as Record<string, unknown>;
}
function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function array(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const item = value[key];
  if (!Array.isArray(item)) throw new Error("Invalid source event");
  return item.map((entry) => objectOrEmpty(entry));
}

function expectedVdocKeys(
  attachments: readonly { vdocKey: string }[],
): string[] {
  return [...new Set(attachments.map((attachment) => attachment.vdocKey))]
    .sort();
}

function dateFrom(value: unknown): Date | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value)
    : null;
}
function date(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
function noWriteError(message: string): UnexpectedError {
  return new UnexpectedError({ cause: new Error(message) });
}

function unexpectedError(error: unknown, fallback: string): UnexpectedError {
  return new UnexpectedError({
    cause: error instanceof Error ? error : new Error(fallback),
  });
}

function sanitizedError(error: unknown): string {
  return error instanceof Error && error.message.startsWith("CWS")
    ? "CWS request failed"
    : "Operation failed";
}

async function payloadHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function deliveryStatus(value: unknown):
  | "pending"
  | "active"
  | "completed"
  | "partial"
  | "failed"
  | "review-required"
  | "approval-revoked" {
  return value === "pending" || value === "active" || value === "completed" ||
      value === "partial" || value === "review-required" ||
      value === "approval-revoked"
    ? value
    : "failed";
}
function failureStatus(value: unknown): "open" | "resolved" | "dismissed" {
  return value === "resolved" || value === "dismissed" ? value : "open";
}
function failureClass(
  value: unknown,
):
  | "validation"
  | "not-found"
  | "timeout"
  | "transient"
  | "code-bug"
  | "unknown" {
  return value === "validation" || value === "not-found" ||
      value === "timeout" || value === "transient" || value === "code-bug"
    ? value
    : "unknown";
}
function reportStatus(
  value: unknown,
): "pending" | "running" | "completed" | "failed" {
  return value === "running" || value === "completed" || value === "failed"
    ? value
    : "pending";
}
function reportType(
  value: unknown,
): "deliveries" | "failures" | "sync-audit" | "backfill" {
  return value === "failures" || value === "sync-audit" || value === "backfill"
    ? value
    : "deliveries";
}
function reportFormat(value: string | undefined): "csv" | "json" {
  return value === "csv" ? "csv" : "json";
}
