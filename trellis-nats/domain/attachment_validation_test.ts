import { assertEquals } from "jsr:@std/assert@1.0.16";
import {
  receiveAndValidateAttachment,
  type FoodLogiQAttachmentTransferClient,
} from "./attachment_validation.ts";

function client(bytes: Uint8Array): FoodLogiQAttachmentTransferClient {
  return {
    documentsFilesDownload: () => ({ orThrow: async () => ({ transfer: { id: "grant" } }) }),
    transfer: () => ({ bytes: () => ({ orThrow: async () => bytes }) }),
  };
}

Deno.test("receiveAndValidateAttachment validates received PDF bytes", async () => {
  const result = await receiveAndValidateAttachment(client(new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31,
  ])), {
    attachmentId: "attachment-1",
    filename: "certificate.pdf",
    declaredContentType: "application/pdf",
    expectedByteLength: "6",
  });

  assertEquals(result.reviewRequired, false);
  assertEquals(result.byteLength, "6");
  assertEquals(result.format.selectedExtension, "pdf");
});

Deno.test("receiveAndValidateAttachment blocks a source-hash mismatch", async () => {
  const result = await receiveAndValidateAttachment(client(new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d,
  ])), {
    attachmentId: "attachment-1",
    filename: "certificate.pdf",
    expectedSha256: "not-the-download-hash",
  });

  assertEquals(result.reviewRequired, true);
  assertEquals(result.reason, "Downloaded bytes do not match the source SHA-256");
});

Deno.test("receiveAndValidateAttachment tags empty attachments for review", async () => {
  const result = await receiveAndValidateAttachment(client(new Uint8Array()), {
    attachmentId: "attachment-1",
    filename: "empty.pdf",
    declaredContentType: "application/pdf",
    expectedByteLength: "0",
  });

  assertEquals(result.reviewRequired, true);
  assertEquals(result.reason, "Attachment is empty");
  assertEquals(result.reviewCode, "empty-attachment");
});
