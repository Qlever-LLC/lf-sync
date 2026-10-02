import { FileInfoSchema } from "@qlever-llc/trellis";
import { eventActions, rpcAction, schema } from "@qlever-llc/trellis/contracts";
import { type StaticDecode, Type } from "typebox";

export const FOODLOGIQ_SYNC_CONTRACT_ID = "foodlogiq.sync@v1" as const;

const IdSchema = Type.String({ minLength: 1, maxLength: 512 });
const TimestampSchema = Type.String({ minLength: 1, format: "date-time" });
const DocumentTypeKeySchema = Type.String({ minLength: 1 });

export const FoodLogiQDocumentSchema = Type.Object({
  id: IdSchema,
  documentTypeKey: DocumentTypeKeySchema,
  foodLogiqDocumentId: IdSchema,
  foodLogiqBusinessId: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  foodLogiqCurrentVersionId: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  supplier: Type.Object({}, { additionalProperties: true }),
  source: Type.Object({}, { additionalProperties: true }),
  sourceHash: IdSchema,
  syncedAt: TimestampSchema,
  updatedAt: TimestampSchema,
}, { additionalProperties: true });

export const FoodLogiQDocumentFileSchema = Type.Object({
  id: IdSchema,
  documentId: IdSchema,
  documentVersionId: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  attachmentKey: IdSchema,
  fileName: Type.Optional(Type.Union([
    Type.String({ minLength: 1, maxLength: 1024 }),
    Type.Null(),
  ])),
  contentType: Type.Optional(Type.Union([
    Type.String({ minLength: 1, maxLength: 256 }),
    Type.Null(),
  ])),
  byteLength: Type.Optional(Type.Union([
    Type.Integer({ minimum: 0 }),
    Type.Null(),
  ])),
  sha256: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("fetched"),
    Type.Literal("failed"),
  ]),
  updatedAt: TimestampSchema,
}, { additionalProperties: true });

export const FoodLogiQDocumentsReadyForLaserficheEventSchema = Type.Object({
  sourceDocumentId: IdSchema,
  sourceVersionId: IdSchema,
  documentTypeKey: DocumentTypeKeySchema,
  approval: Type.Object({
    state: Type.Literal("approved"),
    changedAt: TimestampSchema,
  }),
  archiveReadiness: Type.Object({
    state: Type.Literal("ready"),
    readinessHash: IdSchema,
    approvalConfirmationId: IdSchema,
    reviewDecisionId: Type.Optional(IdSchema),
    writebackConfirmedAt: TimestampSchema,
  }),
  tradingPartnerSource: Type.Object({
    origin: Type.Literal("foodlogiq"),
    sourceType: Type.Literal("business"),
    sourceId: IdSchema,
  }),
  filing: Type.Object({
    supplier: Type.Object({
      id: IdSchema,
      name: Type.String({ minLength: 1 }),
      addressText: Type.Optional(Type.String({ minLength: 1 })),
    }),
    document: Type.Object({
      documentName: Type.Optional(Type.String({ minLength: 1 })),
      documentTypeName: Type.String({ minLength: 1 }),
      documentDate: Type.String({ minLength: 1 }),
      expirationDate: Type.Optional(Type.String({ minLength: 1 })),
      products: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      locations: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      ticketSystem: Type.Optional(Type.String({ minLength: 1 })),
      ticketId: Type.Optional(Type.String({ minLength: 1 })),
    }),
  }),
  attachments: Type.Array(
    Type.Object({
      attachmentId: IdSchema,
      fileName: Type.String({ minLength: 1 }),
      sha256: IdSchema,
      contentType: Type.Optional(Type.String({ minLength: 1 })),
      byteLength: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    { minItems: 1 },
  ),
  syncProvenance: Type.Optional(Type.Object({
    source: Type.Union([
      Type.Literal("scheduled-poll"),
      Type.Literal("catch-up-script"),
      Type.Literal("backfill-script"),
      Type.Literal("direct-retention"),
      Type.Literal("review-decision"),
      Type.Literal("operator"),
      Type.Literal("unknown"),
    ]),
    runId: Type.Optional(Type.String({ minLength: 1 })),
    scriptName: Type.Optional(Type.String({ minLength: 1 })),
    pollWindowFrom: Type.Optional(TimestampSchema),
    pollWindowTo: Type.Optional(TimestampSchema),
    publishedAt: Type.Optional(TimestampSchema),
  })),
  occurredAt: TimestampSchema,
});

export const FoodLogiQDocumentsApprovalRevokedEventSchema = Type.Object({
  sourceDocumentId: IdSchema,
  sourceVersionId: IdSchema,
  priorReviewDecisionId: IdSchema,
  revisionDecisionId: IdSchema,
  status: Type.Union([
    Type.Literal("Rejected"),
    Type.Literal("Awaiting Approval"),
  ]),
  occurredAt: TimestampSchema,
});

export const FoodLogiQDocumentsGetRequestSchema = Type.Object({
  documentId: IdSchema,
}, { additionalProperties: false });

export const FoodLogiQDocumentsGetResponseSchema = Type.Object({
  document: FoodLogiQDocumentSchema,
}, { additionalProperties: true });

export const FoodLogiQDocumentsFilesListRequestSchema = Type.Object({
  documentId: IdSchema,
  documentVersionId: Type.Optional(IdSchema),
}, { additionalProperties: false });

export const FoodLogiQDocumentsFilesListResponseSchema = Type.Object({
  entries: Type.Array(FoodLogiQDocumentFileSchema),
});

export const FoodLogiQDocumentsFilesHeadRequestSchema = Type.Object({
  attachmentId: IdSchema,
}, { additionalProperties: false });

export const FoodLogiQDocumentsFilesHeadResponseSchema = Type.Object({
  attachment: FoodLogiQDocumentFileSchema,
  available: Type.Boolean(),
});

export const FoodLogiQDocumentsFilesDownloadRequestSchema = Type.Object({
  attachmentId: IdSchema,
}, { additionalProperties: false });

const FoodLogiQReceiveTransferGrantSchema = Type.Object({
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

export const FoodLogiQDocumentsFilesDownloadResponseSchema = Type.Object({
  transfer: FoodLogiQReceiveTransferGrantSchema,
});

export const FoodLogiQDocumentsFilesReadChunkRequestSchema = Type.Object({
  attachmentId: IdSchema,
  offset: Type.Integer({ minimum: 0 }),
  length: Type.Integer({ minimum: 1, maximum: 262144 }),
}, { additionalProperties: false });

export const FoodLogiQDocumentsFilesReadChunkResponseSchema = Type.Object({
  attachmentId: IdSchema,
  offset: Type.Integer({ minimum: 0 }),
  byteLength: Type.Integer({ minimum: 0 }),
  totalByteLength: Type.Integer({ minimum: 0 }),
  sha256: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  contentType: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  dataBase64: Type.String(),
  done: Type.Boolean(),
}, { additionalProperties: false });

export const DocumentsGet = rpcAction(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.Get",
  {
    subject: "rpc.v1.foodlogiq.documents.get",
    input: schema<StaticDecode<typeof FoodLogiQDocumentsGetRequestSchema>>(
      FoodLogiQDocumentsGetRequestSchema,
    ),
    output: schema<StaticDecode<typeof FoodLogiQDocumentsGetResponseSchema>>(
      FoodLogiQDocumentsGetResponseSchema,
    ),
    callerCapabilities: [] as const,
  },
  "DocumentsGet",
);

export const DocumentsFilesList = rpcAction(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.Files.List",
  {
    subject: "rpc.v1.foodlogiq.documents.files.list",
    input: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesListRequestSchema>
    >(FoodLogiQDocumentsFilesListRequestSchema),
    output: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesListResponseSchema>
    >(FoodLogiQDocumentsFilesListResponseSchema),
    callerCapabilities: [] as const,
  },
  "DocumentsFilesList",
);

export const DocumentsFilesHead = rpcAction(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.Files.Head",
  {
    subject: "rpc.v1.foodlogiq.documents.files.head",
    input: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesHeadRequestSchema>
    >(FoodLogiQDocumentsFilesHeadRequestSchema),
    output: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesHeadResponseSchema>
    >(FoodLogiQDocumentsFilesHeadResponseSchema),
    callerCapabilities: [] as const,
  },
  "DocumentsFilesHead",
);

export const DocumentsFilesDownload = rpcAction(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.Files.Download",
  {
    subject: "rpc.v1.foodlogiq.documents.files.download",
    input: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesDownloadRequestSchema>
    >(FoodLogiQDocumentsFilesDownloadRequestSchema),
    output: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesDownloadResponseSchema>
    >(FoodLogiQDocumentsFilesDownloadResponseSchema),
    callerCapabilities: [] as const,
    transfer: { direction: "receive" },
  },
  "DocumentsFilesDownload",
);

export const DocumentsFilesReadChunk = rpcAction(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.Files.ReadChunk",
  {
    subject: "rpc.v1.foodlogiq.documents.files.read_chunk",
    input: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesReadChunkRequestSchema>
    >(FoodLogiQDocumentsFilesReadChunkRequestSchema),
    output: schema<
      StaticDecode<typeof FoodLogiQDocumentsFilesReadChunkResponseSchema>
    >(FoodLogiQDocumentsFilesReadChunkResponseSchema),
    callerCapabilities: [] as const,
  },
  "DocumentsFilesReadChunk",
);

export const DocumentsReadyForLaserfiche = eventActions(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.ReadyForLaserfiche",
  {
    subject: "events.v1.foodlogiq.documents.ready_for_laserfiche",
    event: schema<
      StaticDecode<typeof FoodLogiQDocumentsReadyForLaserficheEventSchema>
    >(FoodLogiQDocumentsReadyForLaserficheEventSchema),
    publishCapabilities: [] as const,
    subscribeCapabilities: [] as const,
  },
  "DocumentsReadyForLaserfiche",
  false,
);

export const DocumentsApprovalRevoked = eventActions(
  FOODLOGIQ_SYNC_CONTRACT_ID,
  "Documents.ApprovalRevoked",
  {
    subject: "events.v1.foodlogiq.documents.approval_revoked",
    event: schema<
      StaticDecode<typeof FoodLogiQDocumentsApprovalRevokedEventSchema>
    >(FoodLogiQDocumentsApprovalRevokedEventSchema),
    publishCapabilities: [] as const,
    subscribeCapabilities: [] as const,
  },
  "DocumentsApprovalRevoked",
  false,
);

export const foodlogiqSync = {
  CONTRACT_ID: FOODLOGIQ_SYNC_CONTRACT_ID,
  DocumentsGet,
  DocumentsFilesList,
  DocumentsFilesHead,
  DocumentsFilesDownload,
  DocumentsFilesReadChunk,
  DocumentsReadyForLaserfiche,
  DocumentsApprovalRevoked,
} as const;

export default foodlogiqSync;
