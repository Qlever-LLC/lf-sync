import { defineServiceContract, jobs, store } from "@qlever-llc/trellis";
import * as schemas from "../schemas/index.ts";
import foodlogiqSync from "./foodlogiq_sync.ts";

const jobBackoffMs = [5_000, 30_000, 120_000, 600_000] as const;
const idempotencyKeyConcurrency = {
  key: ["/idempotencyKey"],
  maxActive: 1,
  heartbeatIntervalMs: 30_000,
  heartbeatTtlMs: 120_000,
  stalePolicy: "fail-stale",
} as const;

const capabilities = {
  "deliveries.read": {
    displayName: "Read deliveries",
    description: "Read document delivery status and history.",
  },
  "reports.read": {
    displayName: "Read reports",
    description: "Read generated report metadata and status.",
  },
  "reports.export": {
    displayName: "Export reports",
    description: "Generate and download LF Sync reports.",
  },
  "sync.request": {
    displayName: "Request sync",
    description: "Request synchronization of an approved FoodLogiQ document.",
  },
  "failures.read": {
    displayName: "Read failures",
    description: "Read sanitized synchronization failure records.",
  },
  "failures.manage": {
    displayName: "Manage failures",
    description: "Replay terminal synchronization failures after correction.",
  },
  "backfills.control": {
    displayName: "Control backfills",
    description: "Start and control approved FoodLogiQ document backfills.",
  },
  admin: {
    displayName: "Administer LF Sync",
    description: "Perform high-impact LF Sync administration.",
  },
} as const;

export const lfSync = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "lf-sync@v1",
    displayName: "Laserfiche Sync",
    description:
      "Delivers all approved FoodLogiQ documents to Laserfiche and exposes client dashboard state.",
    capabilities,
    exports: {
      schemas: [
        "LfSyncPaginationRequestSchema",
        "LfSyncPageInfoSchema",
        "LfSyncDateRangeFilterSchema",
        "LfSyncDashboardFilterSchema",
        "LfSyncDeliveriesFilterSchema",
        "LfSyncFailuresFilterSchema",
        "LfSyncReportsFilterSchema",
        "LfSyncSanitizedClientFailureSchema",
        "LfSyncFailureSummarySchema",
        "LfSyncFailureSchema",
        "LfSyncDeliverySchema",
        "LfSyncReportSchema",
      ],
    },
    uses: [
      foodlogiqSync.DocumentsReadyForLaserfiche.subscribe,
      foodlogiqSync.DocumentsApprovalRevoked.subscribe,
      foodlogiqSync.DocumentsGet,
      foodlogiqSync.DocumentsFilesList,
      foodlogiqSync.DocumentsFilesHead,
      foodlogiqSync.DocumentsFilesDownload,
      foodlogiqSync.DocumentsFilesReadChunk,
      store({
        migrationObjects: {
          purpose:
            "Persistent staging for the finite, one-time Legacy OADA migration.",
          required: true,
          ttlMs: 0,
        },
        reportObjects: {
          purpose:
            "Hold capability-gated, generated LF Sync reports separate from migration evidence.",
          required: true,
          ttlMs: 2_592_000_000,
        },
      }),
      jobs({
        processSourceEvent: {
          payload: ref.schema("LfSyncProcessSourceEventJobPayloadSchema"),
          result: ref.schema("LfSyncProcessSourceEventJobResultSchema"),
          maxDeliver: 5,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        loadSourceDocument: {
          payload: ref.schema("LfSyncLoadSourceDocumentJobPayloadSchema"),
          result: ref.schema("LfSyncLoadSourceDocumentJobResultSchema"),
          maxDeliver: 5,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        prepareDelivery: {
          payload: ref.schema("LfSyncPrepareDeliveryJobPayloadSchema"),
          result: ref.schema("LfSyncPrepareDeliveryJobResultSchema"),
          maxDeliver: 5,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        submitLaserfiche: {
          payload: ref.schema("LfSyncSubmitLaserficheJobPayloadSchema"),
          result: ref.schema("LfSyncSubmitLaserficheJobResultSchema"),
          maxDeliver: 5,
          ackWaitMs: 600_000,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        finalizeDelivery: {
          payload: ref.schema("LfSyncFinalizeDeliveryJobPayloadSchema"),
          result: ref.schema("LfSyncFinalizeDeliveryJobResultSchema"),
          maxDeliver: 5,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        processBackfillPage: {
          payload: ref.schema("LfSyncProcessBackfillPageJobPayloadSchema"),
          result: ref.schema("LfSyncProcessBackfillPageJobResultSchema"),
          maxDeliver: 5,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
        generateReport: {
          payload: ref.schema("LfSyncGenerateReportJobPayloadSchema"),
          result: ref.schema("LfSyncGenerateReportJobResultSchema"),
          maxDeliver: 5,
          ackWaitMs: 600_000,
          backoffMs: jobBackoffMs,
          keyConcurrency: idempotencyKeyConcurrency,
        },
      }),
    ],
    eventConsumers: {
      sourceDocuments: {
        uses: {
          [foodlogiqSync.CONTRACT_ID]: [
            "Documents.ReadyForLaserfiche",
            "Documents.ApprovalRevoked",
          ],
        },
        replay: "all",
        ordering: "strict",
        ackWaitMs: 300_000,
        maxDeliver: 5,
        backoffMs: jobBackoffMs,
      },
    },
    rpc: {
      "Dashboard.Summary": {
        version: "v1",
        input: ref.schema("LfSyncDashboardSummaryRequestSchema"),
        output: ref.schema("LfSyncDashboardSummaryResponseSchema"),
        capabilities: {
          call: ["deliveries.read", "failures.read", "reports.read"],
        },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Deliveries.List": {
        version: "v1",
        input: ref.schema("LfSyncDeliveriesListRequestSchema"),
        output: ref.schema("LfSyncDeliveriesListResponseSchema"),
        capabilities: { call: ["deliveries.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Deliveries.Get": {
        version: "v1",
        input: ref.schema("LfSyncDeliveriesGetRequestSchema"),
        output: ref.schema("LfSyncDeliveriesGetResponseSchema"),
        capabilities: { call: ["deliveries.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Documents.Status": {
        version: "v1",
        input: ref.schema("LfSyncDocumentsStatusRequestSchema"),
        output: ref.schema("LfSyncDocumentsStatusResponseSchema"),
        capabilities: { call: ["deliveries.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Failures.List": {
        version: "v1",
        input: ref.schema("LfSyncFailuresListRequestSchema"),
        output: ref.schema("LfSyncFailuresListResponseSchema"),
        capabilities: { call: ["failures.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Failures.Summary": {
        version: "v1",
        input: ref.schema("LfSyncFailuresSummaryRequestSchema"),
        output: ref.schema("LfSyncFailuresSummaryResponseSchema"),
        capabilities: { call: ["failures.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Failures.Types": {
        version: "v1",
        input: ref.schema("LfSyncFailuresTypesRequestSchema"),
        output: ref.schema("LfSyncFailuresTypesResponseSchema"),
        capabilities: { call: ["failures.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Failures.Get": {
        version: "v1",
        input: ref.schema("LfSyncFailuresGetRequestSchema"),
        output: ref.schema("LfSyncFailuresGetResponseSchema"),
        capabilities: { call: ["failures.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Reports.List": {
        version: "v1",
        input: ref.schema("LfSyncReportsListRequestSchema"),
        output: ref.schema("LfSyncReportsListResponseSchema"),
        capabilities: { call: ["reports.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Reports.Get": {
        version: "v1",
        input: ref.schema("LfSyncReportsGetRequestSchema"),
        output: ref.schema("LfSyncReportsGetResponseSchema"),
        capabilities: { call: ["reports.read"] },
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Reports.Download": {
        version: "v1",
        input: ref.schema("LfSyncReportsDownloadRequestSchema"),
        output: ref.schema("LfSyncReportsDownloadResponseSchema"),
        transfer: { direction: "receive" },
        capabilities: { call: ["reports.export"] },
        errors: ["ValidationError", "TransferError", "UnexpectedError"],
      },
    },
    operations: {
      "Reports.Generate": {
        version: "v1",
        input: ref.schema("LfSyncReportsGenerateRequestSchema"),
        progress: ref.schema("LfSyncOperationProgressSchema"),
        output: ref.schema("LfSyncReportsGenerateResultSchema"),
        capabilities: {
          call: ["reports.export"],
          observe: ["reports.read"],
          cancel: ["reports.export"],
          control: ["reports.export"],
        },
        cancel: true,
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Documents.Sync": {
        version: "v1",
        input: ref.schema("LfSyncDocumentsSyncRequestSchema"),
        progress: ref.schema("LfSyncOperationProgressSchema"),
        output: ref.schema("LfSyncDocumentsSyncResultSchema"),
        capabilities: {
          call: ["sync.request"],
          observe: ["deliveries.read"],
          cancel: ["sync.request"],
          control: ["sync.request"],
        },
        cancel: true,
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Failures.Replay": {
        version: "v1",
        input: ref.schema("LfSyncFailuresReplayRequestSchema"),
        progress: ref.schema("LfSyncOperationProgressSchema"),
        output: ref.schema("LfSyncFailuresReplayResultSchema"),
        capabilities: {
          call: ["failures.manage", "admin"],
          observe: ["failures.read"],
          cancel: ["failures.manage", "admin"],
          control: ["failures.manage", "admin"],
        },
        cancel: true,
        errors: ["ValidationError", "UnexpectedError"],
      },
      "Backfills.Run": {
        version: "v1",
        input: ref.schema("LfSyncBackfillsRunRequestSchema"),
        progress: ref.schema("LfSyncOperationProgressSchema"),
        output: ref.schema("LfSyncBackfillsRunResultSchema"),
        capabilities: {
          call: ["backfills.control", "admin"],
          observe: ["backfills.control"],
          cancel: ["backfills.control", "admin"],
          control: ["backfills.control", "admin"],
        },
        cancel: true,
        errors: ["ValidationError", "UnexpectedError"],
      },
    },
    events: {
      "LfSync.Document.Requested": {
        version: "v1",
        event: ref.schema("LfSyncDocumentRequestedEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["deliveries.read"],
        },
      },
      "LfSync.Document.Completed": {
        version: "v1",
        event: ref.schema("LfSyncDocumentCompletedEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["deliveries.read"],
        },
      },
      "LfSync.Document.Partial": {
        version: "v1",
        event: ref.schema("LfSyncDocumentPartialEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["deliveries.read", "failures.read"],
        },
      },
      "LfSync.Document.Failed": {
        version: "v1",
        event: ref.schema("LfSyncDocumentFailedEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["failures.read"],
        },
      },
      "LfSync.Document.ReviewRequired": {
        version: "v1",
        event: ref.schema("LfSyncDocumentReviewRequiredEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["failures.read"],
        },
      },
      "LfSync.Document.ApprovalRevoked": {
        version: "v1",
        event: ref.schema("LfSyncDocumentApprovalRevokedEventSchema"),
        capabilities: {
          publish: ["service"],
          subscribe: ["deliveries.read"],
        },
      },
    },
  }),
);

export default lfSync;
