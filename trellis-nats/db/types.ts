export type DbId = string;
export type JsonObject = Readonly<Record<string, unknown>>;
export type SourceDocumentStatus = "received" | "ready" | "superseded";
export type WorkflowStatus =
  | "pending"
  | "active"
  | "review-required"
  | "approval-revoked"
  | "completed"
  | "partial"
  | "failed";
export type TerminalWorkflowStatus =
  | "review-required"
  | "approval-revoked"
  | "completed"
  | "partial"
  | "failed";
export type DeliveryAction = "create" | "update";
export type AttemptOutcome = "started" | "succeeded" | "failed";
export type FailureClass =
  | "validation"
  | "not-found"
  | "timeout"
  | "transient"
  | "code-bug"
  | "unknown";
export type FailureStatus = "open" | "resolved" | "dismissed";
export type InboxStatus = "pending" | "processing" | "completed" | "failed";
export type MigrationStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "skipped";
export type ReportStatus = "pending" | "running" | "completed" | "failed";

export interface SourceDocumentRecord extends Record<string, unknown> {
  id: DbId;
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  readinessHash: string;
  documentType: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: SourceDocumentStatus;
  payload: JsonObject;
  provenance: JsonObject;
  approvedAt: Date | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceAttachmentRecord extends Record<string, unknown> {
  id: DbId;
  sourceDocumentId: DbId;
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  vdocKey: string;
  byteReference: string;
  contentType: string;
  fileName: string | null;
  sizeBytes: DbId | null;
  checksum: string | null;
  payload: JsonObject;
  provenance: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryContentInput {
  deliveryId: DbId;
  claimOwner?: string;
  directoryId: DbId;
  sha256: string;
  byteLength: string;
  contentType: string;
  uploadExtension: string;
}

export interface ExistingDeliveryContentRecord extends Record<string, unknown> {
  deliveryId: DbId;
  entryId: DbId;
  sha256: string;
  byteLength: string;
  contentType: string;
  uploadExtension: string;
}

export interface DeliveryQueueSnapshot extends Record<string, unknown> {
  capturedAt: string;
  deliveriesByStatus: JsonObject;
  activeDeliveries: number;
  openFailures: number;
  oldestActiveDeliveryAgeSeconds: number | null;
}

export interface LaserficheDirectoryRecord extends Record<string, unknown> {
  id: DbId;
  repository: string;
  canonicalPath: string;
  parentDirectoryId: DbId | null;
  cwsEntryId: DbId | null;
  name: string;
  status: "pending" | "verified" | "failed";
  verifiedAt: Date | null;
  metadata: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncRequestRecord extends Record<string, unknown> {
  id: DbId;
  sourceDocumentId: DbId;
  requestKey: string;
  operationId: string | null;
  requestedBy: string | null;
  reason: string;
  status: WorkflowStatus;
  requestedVdocKeys: string[];
  result: JsonObject | null;
  provenance: JsonObject;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryRecord extends Record<string, unknown> {
  id: DbId;
  syncRequestId: DbId;
  sourceDocumentId: DbId;
  sourceAttachmentId: DbId;
  externalSourceDocumentId: string;
  sourceVersion: string;
  vdocKey: string;
  documentType: string | null;
  supplier: string | null;
  idempotencyKey: string;
  payloadHash: string;
  action: DeliveryAction;
  status: WorkflowStatus;
  repository: string;
  targetPath: string;
  targetName: string;
  payload: JsonObject;
  provenance: JsonObject;
  syncProvenance: JsonObject | null;
  result: JsonObject | null;
  byteLength: string | null;
  entryId: DbId | null;
  uploadCompletedAt: Date | null;
  retryCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  lastRetryReason: string | null;
  approvedAt: Date | null;
  requestedAt: Date;
  attemptCount: number;
  failureCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntryMappingRecord extends Record<string, unknown> {
  id: DbId;
  deliveryId: DbId;
  repository: string;
  entryId: DbId;
  idempotencyKey: string;
  payloadHash: string;
  provenance: JsonObject;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryAttemptRecord extends Record<string, unknown> {
  id: DbId;
  deliveryId: DbId;
  stage: string;
  attemptNumber: number;
  outcome: AttemptOutcome;
  retryable: boolean | null;
  durationMs: number | null;
  requestContext: JsonObject;
  responseContext: JsonObject;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntitySnapshotRecord extends Record<string, unknown> {
  id: DbId;
  syncRequestId: DbId;
  entityId: string;
  entityVersion: string;
  snapshot: JsonObject;
  provenance: JsonObject;
  sourceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FailureRecord extends Record<string, unknown> {
  id: DbId;
  syncRequestId: DbId | null;
  deliveryId: DbId | null;
  sourceDocumentId: DbId | null;
  externalSourceDocumentId: string | null;
  vdocKey: string | null;
  documentType: string | null;
  supplier: string | null;
  targetPath: string | null;
  stage: string;
  failureClass: FailureClass;
  status: FailureStatus;
  reason: string;
  retryable: boolean;
  statusCode: number | null;
  attemptNumber: number | null;
  context: JsonObject;
  provenance: JsonObject;
  occurredAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FailureSummaryMetrics extends Record<string, unknown> {
  activeOpen: number;
  reviewOpen: number;
  staleOpen: number;
  resolved: number;
  dismissed: number;
  total: number;
}

export interface FailureTypeSummary extends Record<string, unknown> {
  key: string;
  stage: string;
  failureClass: FailureClass;
  reason: string;
  open: number;
  resolved: number;
  dismissed: number;
  total: number;
  latestOccurredAt: Date;
}

export interface InboxRecord extends Record<string, unknown> {
  id: DbId;
  consumer: string;
  eventId: string;
  eventType: string;
  status: InboxStatus;
  payload: JsonObject;
  provenance: JsonObject;
  claimOwner: string | null;
  claimedUntil: Date | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: Date;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationBatchRecord extends Record<string, unknown> {
  id: DbId;
  batchKey: string;
  source: string;
  status: MigrationStatus;
  checkpoint: JsonObject;
  totals: JsonObject;
  provenance: JsonObject;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationItemRecord extends Record<string, unknown> {
  id: DbId;
  migrationBatchId: DbId;
  itemKey: string;
  sourceVersion: string | null;
  status: MigrationStatus;
  checkpoint: JsonObject;
  payload: JsonObject;
  result: JsonObject | null;
  lastError: string | null;
  attemptCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRunRecord extends Record<string, unknown> {
  id: DbId;
  reportType: string;
  requestedBy: string | null;
  status: ReportStatus;
  parameters: JsonObject;
  result: JsonObject | readonly unknown[] | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PageCursor {
  createdAt: Date;
  id: DbId;
}

export interface Page<T> {
  items: readonly T[];
  nextCursor: PageCursor | null;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface DeliveryDetails {
  delivery: DeliveryRecord;
  failures: readonly FailureRecord[];
}

export interface DocumentStatusRecord {
  sourceDocumentId: string;
  sourceVersion: string | null;
  status: "unknown" | WorkflowStatus;
  updatedAt: Date | null;
  deliveries: readonly DeliveryRecord[];
  failures: readonly FailureRecord[];
}

export interface DashboardSummary extends Record<string, unknown> {
  sourceDocuments: number;
  documentsDelivered: number;
  documentBytesDelivered: string | null;
  completionTrend: DashboardTrendPoint[];
  deliveriesPending: number;
  deliveriesActive: number;
  deliveriesReviewRequired: number;
  deliveriesApprovalRevoked: number;
  deliveriesCompleted: number;
  deliveriesPartial: number;
  deliveriesFailed: number;
  openFailures: number;
  inboxBacklog: number;
  outboxBacklog: number;
}

export interface DashboardTrendPoint extends Record<string, unknown> {
  bucketStart: string;
  documentsDelivered: number;
  documentBytesDelivered?: string;
  averageCompletionLatencyMs?: number;
}
