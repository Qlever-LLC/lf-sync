import { assert, assertEquals } from "jsr:@std/assert";
import {
  DocumentsApprovalRevoked,
  DocumentsFilesDownload,
  DocumentsFilesHead,
  DocumentsFilesList,
  DocumentsFilesReadChunk,
  DocumentsGet,
  DocumentsReadyForLaserfiche,
  FoodLogiQDocumentsReadyForLaserficheEventSchema,
} from "./foodlogiq_sync.ts";

Deno.test("FoodLogiQ descriptors stay aligned with its published contract", () => {
  assertEquals(DocumentsGet.subject, "rpc.v1.foodlogiq.documents.get");
  assertEquals(
    DocumentsFilesList.subject,
    "rpc.v1.foodlogiq.documents.files.list",
  );
  assertEquals(
    DocumentsFilesHead.subject,
    "rpc.v1.foodlogiq.documents.files.head",
  );
  assertEquals(
    DocumentsFilesDownload.subject,
    "rpc.v1.foodlogiq.documents.files.download",
  );
  assertEquals(
    DocumentsFilesReadChunk.subject,
    "rpc.v1.foodlogiq.documents.files.read_chunk",
  );
  assertEquals(
    DocumentsReadyForLaserfiche.subscribe.subject,
    "events.v1.foodlogiq.documents.ready_for_laserfiche",
  );
  const readiness = FoodLogiQDocumentsReadyForLaserficheEventSchema;
  assert(
    "approvalConfirmationId" in
      readiness.properties.archiveReadiness.properties,
  );
  assertEquals(readiness.properties.archiveReadiness.required, [
    "state",
    "readinessHash",
    "approvalConfirmationId",
    "writebackConfirmedAt",
  ]);
  assertEquals(
    DocumentsApprovalRevoked.subscribe.subject,
    "events.v1.foodlogiq.documents.approval_revoked",
  );
});
