import { FileInfoSchema } from "@qlever-llc/trellis";
import { Type } from "typebox";

const IdSchema = Type.String({ minLength: 1, maxLength: 512 });
const TimestampSchema = Type.String({ minLength: 1, format: "date-time" });

export const LfSyncSourceRecordRefSchema = Type.Object({
  origin: IdSchema,
  sourceType: IdSchema,
  sourceId: IdSchema,
}, { additionalProperties: false });

export const LfSyncFailureClassSchema = Type.Union([
  Type.Literal("validation"),
  Type.Literal("not-found"),
  Type.Literal("timeout"),
  Type.Literal("transient"),
  Type.Literal("code-bug"),
  Type.Literal("unknown"),
]);

export const LfSyncDeliveryStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("active"),
  Type.Literal("completed"),
  Type.Literal("partial"),
  Type.Literal("failed"),
  Type.Literal("review-required"),
  Type.Literal("approval-revoked"),
]);

export const LfSyncFailureStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("resolved"),
  Type.Literal("dismissed"),
]);

export const LfSyncReportStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const LfSyncReportTypeSchema = Type.Union([
  Type.Literal("deliveries"),
  Type.Literal("failures"),
  Type.Literal("sync-audit"),
  Type.Literal("backfill"),
]);

export const LfSyncReportFormatSchema = Type.Union([
  Type.Literal("csv"),
  Type.Literal("json"),
]);

export const LfSyncSyncReasonSchema = Type.Union([
  Type.Literal("approved"),
  Type.Literal("resync"),
  Type.Literal("migration"),
  Type.Literal("manual"),
  Type.Literal("backfill"),
  Type.Literal("failure-replay"),
]);

export const LfSyncPaginationRequestSchema = Type.Object({
  cursor: Type.Optional(IdSchema),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 250, default: 100 }),
  ),
}, { additionalProperties: false });

export const LfSyncPageInfoSchema = Type.Object({
  nextCursor: Type.Optional(IdSchema),
  hasMore: Type.Boolean(),
}, { additionalProperties: false });

export const LfSyncDateRangeFilterSchema = Type.Object({
  from: Type.Optional(TimestampSchema),
  to: Type.Optional(TimestampSchema),
}, { additionalProperties: false });

export const LfSyncDashboardFilterSchema = Type.Object({
  approvedAt: Type.Optional(LfSyncDateRangeFilterSchema),
  updatedAt: Type.Optional(LfSyncDateRangeFilterSchema),
  documentTypes: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  suppliers: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
}, { additionalProperties: false });

export const LfSyncDeliveriesFilterSchema = Type.Object({
  statuses: Type.Optional(Type.Array(LfSyncDeliveryStatusSchema, {
    uniqueItems: true,
  })),
  sourceDocumentId: Type.Optional(IdSchema),
  vdocKey: Type.Optional(IdSchema),
  documentTypes: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  suppliers: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  approvedAt: Type.Optional(LfSyncDateRangeFilterSchema),
  updatedAt: Type.Optional(LfSyncDateRangeFilterSchema),
}, { additionalProperties: false });

export const LfSyncFailuresFilterSchema = Type.Object({
  statuses: Type.Optional(Type.Array(LfSyncFailureStatusSchema, {
    uniqueItems: true,
  })),
  failureClasses: Type.Optional(Type.Array(LfSyncFailureClassSchema, {
    uniqueItems: true,
  })),
  stages: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  retryable: Type.Optional(Type.Boolean()),
  sourceDocumentId: Type.Optional(IdSchema),
  documentTypes: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  suppliers: Type.Optional(Type.Array(IdSchema, { uniqueItems: true })),
  occurredAt: Type.Optional(LfSyncDateRangeFilterSchema),
}, { additionalProperties: false });

export const LfSyncReportsFilterSchema = Type.Object({
  statuses: Type.Optional(Type.Array(LfSyncReportStatusSchema, {
    uniqueItems: true,
  })),
  reportTypes: Type.Optional(Type.Array(LfSyncReportTypeSchema, {
    uniqueItems: true,
  })),
  requestedBy: Type.Optional(IdSchema),
  requestedAt: Type.Optional(LfSyncDateRangeFilterSchema),
}, { additionalProperties: false });

// This closed shape is the only client-error detail exposed to callers.
export const LfSyncSanitizedClientFailureSchema = Type.Object({
  sanitized: Type.Literal(true),
  client: Type.Union([
    Type.Literal("foodlogiq"),
    Type.Literal("laserfiche-cws"),
    Type.Literal("database"),
    Type.Literal("trellis"),
    Type.Literal("unknown"),
  ]),
  operation: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  endpoint: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  statusCode: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
  responseSummary: Type.Optional(
    Type.String({ minLength: 1, maxLength: 4096 }),
  ),
  requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
}, { additionalProperties: false });

export const LfSyncFailureSummarySchema = Type.Object({
  failureId: IdSchema,
  sourceDocumentId: Type.Optional(IdSchema),
  deliveryId: Type.Optional(IdSchema),
  vdocKey: Type.Optional(IdSchema),
  documentType: Type.Optional(IdSchema),
  supplier: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  targetPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  status: LfSyncFailureStatusSchema,
  stage: IdSchema,
  failureClass: LfSyncFailureClassSchema,
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
  retryable: Type.Boolean(),
  attempt: Type.Optional(Type.Integer({ minimum: 1 })),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1 })),
  occurredAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: false });

export const LfSyncFailureSchema = Type.Object({
  failureId: IdSchema,
  correlationId: IdSchema,
  sourceDocumentId: Type.Optional(IdSchema),
  deliveryId: Type.Optional(IdSchema),
  vdocKey: Type.Optional(IdSchema),
  documentType: Type.Optional(IdSchema),
  supplier: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  targetPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  fieldNames: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      uniqueItems: true,
    }),
  ),
  status: LfSyncFailureStatusSchema,
  stage: IdSchema,
  failureClass: LfSyncFailureClassSchema,
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
  retryable: Type.Boolean(),
  attempt: Type.Optional(Type.Integer({ minimum: 1 })),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1 })),
  clientFailure: Type.Optional(LfSyncSanitizedClientFailureSchema),
  context: Type.Optional(Type.Unknown()),
  provenance: Type.Optional(Type.Unknown()),
  occurredAt: TimestampSchema,
  updatedAt: TimestampSchema,
  resolvedAt: Type.Optional(TimestampSchema),
}, { additionalProperties: false });

export const LfSyncDeliverySchema = Type.Object({
  deliveryId: IdSchema,
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  sourceAttachmentId: Type.Optional(IdSchema),
  sourceVersionId: Type.Optional(IdSchema),
  approvalId: Type.Optional(IdSchema),
  vdocKey: IdSchema,
  status: LfSyncDeliveryStatusSchema,
  documentType: IdSchema,
  documentName: Type.String({ minLength: 1, maxLength: 1024 }),
  supplier: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  approvedAt: TimestampSchema,
  requestedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: Type.Optional(TimestampSchema),
  laserficheEntryId: Type.Optional(Type.Integer({ minimum: 1 })),
  targetPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  targetName: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  byteLength: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  reviewCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  reviewReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  syncProvenance: Type.Optional(Type.Object({
    source: Type.String({ minLength: 1 }),
    runId: Type.Optional(Type.String({ minLength: 1 })),
    scriptName: Type.Optional(Type.String({ minLength: 1 })),
    pollWindowFrom: Type.Optional(TimestampSchema),
    pollWindowTo: Type.Optional(TimestampSchema),
    publishedAt: Type.Optional(TimestampSchema),
  }, { additionalProperties: true })),
  metadata: Type.Optional(
    Type.Record(
      Type.String({ minLength: 1 }),
      Type.Union([
        Type.String(),
        Type.Array(Type.String()),
      ]),
    ),
  ),
  attempt: Type.Integer({ minimum: 0 }),
  failureCount: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const LfSyncReportSchema = Type.Object({
  reportId: IdSchema,
  reportType: LfSyncReportTypeSchema,
  format: LfSyncReportFormatSchema,
  status: LfSyncReportStatusSchema,
  requestedBy: IdSchema,
  requestedAt: TimestampSchema,
  completedAt: Type.Optional(TimestampSchema),
  expiresAt: Type.Optional(TimestampSchema),
  rowCount: Type.Optional(Type.Integer({ minimum: 0 })),
  fileName: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  failureReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
}, { additionalProperties: false });

export const LfSyncDashboardSummaryRequestSchema = Type.Object({
  filter: Type.Optional(LfSyncDashboardFilterSchema),
}, { additionalProperties: false });

export const LfSyncDashboardTrendPointSchema = Type.Object({
  bucketStart: TimestampSchema,
  documentsDelivered: Type.Integer({ minimum: 0 }),
  documentBytesDelivered: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  averageCompletionLatencyMs: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

export const LfSyncDashboardSummaryResponseSchema = Type.Object({
  generatedAt: TimestampSchema,
  sourceDocuments: Type.Integer({ minimum: 0 }),
  documentsDelivered: Type.Integer({ minimum: 0 }),
  documentBytesDelivered: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  completionTrend: Type.Array(LfSyncDashboardTrendPointSchema),
  deliveriesPending: Type.Integer({ minimum: 0 }),
  deliveriesActive: Type.Integer({ minimum: 0 }),
  deliveriesCompleted: Type.Integer({ minimum: 0 }),
  deliveriesPartial: Type.Integer({ minimum: 0 }),
  deliveriesFailed: Type.Integer({ minimum: 0 }),
  deliveriesReviewRequired: Type.Integer({ minimum: 0 }),
  deliveriesApprovalRevoked: Type.Integer({ minimum: 0 }),
  openFailures: Type.Integer({ minimum: 0 }),
  inboxBacklog: Type.Integer({ minimum: 0 }),
  outboxBacklog: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const LfSyncDeliveriesListRequestSchema = Type.Object({
  filter: Type.Optional(LfSyncDeliveriesFilterSchema),
  pagination: Type.Optional(LfSyncPaginationRequestSchema),
}, { additionalProperties: false });

export const LfSyncDeliveriesListResponseSchema = Type.Object({
  items: Type.Array(LfSyncDeliverySchema),
  page: LfSyncPageInfoSchema,
}, { additionalProperties: false });

export const LfSyncDeliveriesGetRequestSchema = Type.Object({
  deliveryId: IdSchema,
}, { additionalProperties: false });

export const LfSyncDeliveriesGetResponseSchema = Type.Object({
  delivery: LfSyncDeliverySchema,
  failures: Type.Array(LfSyncFailureSummarySchema),
}, { additionalProperties: false });

export const LfSyncDocumentsStatusRequestSchema = Type.Object({
  sourceDocumentId: IdSchema,
  vdocKey: Type.Optional(IdSchema),
}, { additionalProperties: false });

export const LfSyncDocumentsStatusResponseSchema = Type.Object({
  sourceDocumentId: IdSchema,
  status: Type.Union([
    Type.Literal("unknown"),
    LfSyncDeliveryStatusSchema,
  ]),
  updatedAt: Type.Optional(TimestampSchema),
  deliveries: Type.Array(LfSyncDeliverySchema),
  failures: Type.Array(LfSyncFailureSummarySchema),
}, { additionalProperties: false });

export const LfSyncFailuresListRequestSchema = Type.Object({
  filter: Type.Optional(LfSyncFailuresFilterSchema),
  pagination: Type.Optional(LfSyncPaginationRequestSchema),
}, { additionalProperties: false });

export const LfSyncFailuresListResponseSchema = Type.Object({
  items: Type.Array(LfSyncFailureSummarySchema),
  page: LfSyncPageInfoSchema,
}, { additionalProperties: false });

export const LfSyncFailuresSummaryRequestSchema = Type.Object({}, {
  additionalProperties: false,
});

export const LfSyncFailuresSummaryResponseSchema = Type.Object({
  activeOpen: Type.Integer({ minimum: 0 }),
  reviewOpen: Type.Integer({ minimum: 0 }),
  staleOpen: Type.Integer({ minimum: 0 }),
  resolved: Type.Integer({ minimum: 0 }),
  dismissed: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const LfSyncFailuresTypesRequestSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
}, { additionalProperties: false });

export const LfSyncFailureTypeSummarySchema = Type.Object({
  key: IdSchema,
  stage: Type.String({ minLength: 1 }),
  failureClass: LfSyncFailureClassSchema,
  reason: Type.String({ minLength: 1 }),
  open: Type.Integer({ minimum: 0 }),
  resolved: Type.Integer({ minimum: 0 }),
  dismissed: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
  latestOccurredAt: TimestampSchema,
}, { additionalProperties: false });

export const LfSyncFailuresTypesResponseSchema = Type.Object({
  items: Type.Array(LfSyncFailureTypeSummarySchema),
}, { additionalProperties: false });

export const LfSyncFailuresGetRequestSchema = Type.Object({
  failureId: IdSchema,
}, { additionalProperties: false });

export const LfSyncFailuresGetResponseSchema = Type.Object({
  failure: LfSyncFailureSchema,
}, { additionalProperties: false });

export const LfSyncReportsListRequestSchema = Type.Object({
  filter: Type.Optional(LfSyncReportsFilterSchema),
  pagination: Type.Optional(LfSyncPaginationRequestSchema),
}, { additionalProperties: false });

export const LfSyncReportsListResponseSchema = Type.Object({
  items: Type.Array(LfSyncReportSchema),
  page: LfSyncPageInfoSchema,
}, { additionalProperties: false });

export const LfSyncReportsGetRequestSchema = Type.Object({
  reportId: IdSchema,
}, { additionalProperties: false });

export const LfSyncReportsGetResponseSchema = Type.Object({
  report: LfSyncReportSchema,
}, { additionalProperties: false });

export const LfSyncReportsDownloadRequestSchema = Type.Object({
  reportId: IdSchema,
}, { additionalProperties: false });

const LfSyncReceiveTransferGrantSchema = Type.Object({
  type: Type.Literal("TransferGrant"),
  direction: Type.Literal("receive"),
  service: Type.String({ minLength: 1 }),
  sessionKey: Type.String({ minLength: 1 }),
  transferId: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  expiresAt: Type.String({ minLength: 1 }),
  chunkBytes: Type.Integer({ minimum: 1 }),
  info: FileInfoSchema,
});

export const LfSyncReportsDownloadResponseSchema = Type.Object({
  transfer: LfSyncReceiveTransferGrantSchema,
}, { additionalProperties: false });

export const LfSyncOperationProgressSchema = Type.Object({
  correlationId: IdSchema,
  stage: IdSchema,
  message: Type.String({ minLength: 1, maxLength: 2048 }),
  completedItems: Type.Optional(Type.Integer({ minimum: 0 })),
  totalItems: Type.Optional(Type.Integer({ minimum: 0 })),
  occurredAt: TimestampSchema,
}, { additionalProperties: false });

export const LfSyncReportsGenerateRequestSchema = Type.Object({
  reportType: LfSyncReportTypeSchema,
  format: LfSyncReportFormatSchema,
  requestedBy: IdSchema,
  deliveriesFilter: Type.Optional(LfSyncDeliveriesFilterSchema),
  failuresFilter: Type.Optional(LfSyncFailuresFilterSchema),
}, { additionalProperties: false });

export const LfSyncReportsGenerateResultSchema = Type.Object({
  report: LfSyncReportSchema,
}, { additionalProperties: false });

export const LfSyncDocumentsSyncRequestSchema = Type.Object({
  sourceDocumentId: IdSchema,
  sourceVersionId: Type.Optional(IdSchema),
  approvalId: Type.Optional(IdSchema),
  tradingPartnerSource: Type.Optional(LfSyncSourceRecordRefSchema),
  requestedBy: IdSchema,
  reason: LfSyncSyncReasonSchema,
  vdocKeys: Type.Optional(
    Type.Array(IdSchema, { minItems: 1, uniqueItems: true }),
  ),
}, { additionalProperties: false });

export const LfSyncDocumentsSyncResultSchema = Type.Object({
  correlationId: IdSchema,
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("partial"),
    Type.Literal("review-required"),
  ]),
  deliveries: Type.Array(LfSyncDeliverySchema),
  failures: Type.Array(LfSyncFailureSummarySchema),
}, { additionalProperties: false });

export const LfSyncFailuresReplayRequestSchema = Type.Object({
  failureIds: Type.Array(IdSchema, {
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  }),
  requestedBy: IdSchema,
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
}, { additionalProperties: false });

export const LfSyncFailuresReplayResultSchema = Type.Object({
  correlationId: IdSchema,
  replayedFailureIds: Type.Array(IdSchema),
  skippedFailureIds: Type.Array(IdSchema),
  syncCorrelationIds: Type.Array(IdSchema),
}, { additionalProperties: false });

export const LfSyncBackfillsRunRequestSchema = Type.Object({
  scope: Type.Literal("all-approved-foodlogiq-documents"),
  requestedBy: IdSchema,
  approvedAt: Type.Optional(LfSyncDateRangeFilterSchema),
  resumeCursor: Type.Optional(IdSchema),
  dryRun: Type.Optional(Type.Boolean({ default: false })),
}, { additionalProperties: false });

export const LfSyncBackfillsRunResultSchema = Type.Object({
  correlationId: IdSchema,
  scanned: Type.Integer({ minimum: 0 }),
  requested: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  nextCursor: Type.Optional(IdSchema),
  completed: Type.Boolean(),
}, { additionalProperties: false });

const LifecycleFields = {
  eventId: IdSchema,
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  occurredAt: TimestampSchema,
};

export const LfSyncDocumentRequestedEventSchema = Type.Object({
  ...LifecycleFields,
  sourceVersionId: Type.Optional(IdSchema),
  approvalId: Type.Optional(IdSchema),
  requestedBy: IdSchema,
  reason: LfSyncSyncReasonSchema,
}, { additionalProperties: false });

export const LfSyncDocumentCompletedEventSchema = Type.Object({
  ...LifecycleFields,
  deliveryIds: Type.Array(IdSchema, { minItems: 1, uniqueItems: true }),
  completedCount: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const LfSyncDocumentPartialEventSchema = Type.Object({
  ...LifecycleFields,
  deliveryIds: Type.Array(IdSchema, { uniqueItems: true }),
  completedCount: Type.Integer({ minimum: 0 }),
  failedCount: Type.Integer({ minimum: 1 }),
  failureIds: Type.Array(IdSchema, { minItems: 1, uniqueItems: true }),
}, { additionalProperties: false });

export const LfSyncDocumentFailedEventSchema = Type.Object({
  ...LifecycleFields,
  failure: LfSyncFailureSchema,
}, { additionalProperties: false });

export const LfSyncDocumentReviewRequiredEventSchema = Type.Object({
  ...LifecycleFields,
  failureId: IdSchema,
  stage: IdSchema,
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
  clientFailure: Type.Optional(LfSyncSanitizedClientFailureSchema),
}, { additionalProperties: false });

export const LfSyncDocumentApprovalRevokedEventSchema = Type.Object({
  ...LifecycleFields,
  approvalId: IdSchema,
  revokedBy: IdSchema,
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
}, { additionalProperties: false });

export const LfSyncProcessSourceEventJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  sourceEventId: IdSchema,
  sourceEventName: Type.Union([
    Type.Literal("Documents.ReadyForLaserfiche"),
    Type.Literal("Documents.ApprovalRevoked"),
  ]),
  sourceDocumentId: IdSchema,
  sourceVersionId: Type.Optional(IdSchema),
  approvalId: IdSchema,
  documentTypeKey: Type.String({ minLength: 1, maxLength: 512 }),
  occurredAt: TimestampSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncProcessSourceEventJobResultSchema = Type.Object({
  correlationId: IdSchema,
  disposition: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("ignored"),
  ]),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
}, { additionalProperties: false });

export const LfSyncLoadSourceDocumentJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  sourceVersionId: Type.Optional(IdSchema),
  documentTypeKey: Type.String({ minLength: 1, maxLength: 512 }),
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncLoadSourceDocumentJobResultSchema = Type.Object({
  loaded: Type.Boolean(),
  sourceDocumentId: IdSchema,
  documentTypeKey: Type.String({ minLength: 1, maxLength: 512 }),
  vdocCount: Type.Integer({ minimum: 0 }),
  fileCount: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const LfSyncPrepareDeliveryJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  sourceVersionId: IdSchema,
  vdocKey: IdSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncPrepareDeliveryJobResultSchema = Type.Object({
  deliveryId: Type.Optional(IdSchema),
  prepared: Type.Boolean(),
  targetPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  targetName: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
}, { additionalProperties: false });

export const LfSyncSubmitLaserficheJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  deliveryId: IdSchema,
  vdocKey: IdSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncSubmitLaserficheJobResultSchema = Type.Object({
  laserficheEntryId: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const LfSyncFinalizeDeliveryJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  sourceDocumentId: IdSchema,
  deliveryId: IdSchema,
  vdocKey: IdSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncFinalizeDeliveryJobResultSchema = Type.Object({
  deliveryId: IdSchema,
  status: Type.Union([
    Type.Literal("completed"),
    Type.Literal("partial"),
    Type.Literal("failed"),
    Type.Literal("review-required"),
  ]),
  lifecycleEventId: IdSchema,
}, { additionalProperties: false });

export const LfSyncProcessBackfillPageJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  backfillId: IdSchema,
  cursor: Type.Optional(IdSchema),
  pageSize: Type.Integer({ minimum: 1, maximum: 1_000 }),
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncProcessBackfillPageJobResultSchema = Type.Object({
  scanned: Type.Integer({ minimum: 0 }),
  requested: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  nextCursor: Type.Optional(IdSchema),
  completed: Type.Boolean(),
}, { additionalProperties: false });

export const LfSyncGenerateReportJobPayloadSchema = Type.Object({
  correlationId: IdSchema,
  reportId: IdSchema,
  idempotencyKey: IdSchema,
}, { additionalProperties: false });

export const LfSyncGenerateReportJobResultSchema = Type.Object({
  reportId: IdSchema,
  objectKey: IdSchema,
  rowCount: Type.Integer({ minimum: 0 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  digest: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
}, { additionalProperties: false });

export const LfSyncCwsHealthSchema = Type.Object({
  ok: Type.Boolean(),
  checkedAt: TimestampSchema,
  apiRoot: Type.String({ minLength: 1 }),
  repository: Type.String({ minLength: 1 }),
  root: Type.Optional(Type.Object({
    entryId: Type.Integer({ minimum: 1 }),
    name: Type.String(),
    type: Type.String(),
    path: Type.String(),
  }, { additionalProperties: false })),
  error: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
