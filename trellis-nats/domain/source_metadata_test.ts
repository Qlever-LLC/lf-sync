import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.16";
import { sourceFilingWorkflow } from "./source_metadata.ts";

Deno.test("sourceFilingWorkflow maps normalized FoodLogiQ source fields", () => {
  const workflow = sourceFilingWorkflow({
    supplier: { name: "Acme Foods" },
    source: {
      documentTypeName: "Certificate of Insurance",
      effectiveDate: "2026-09-17",
      expirationDate: "2027-09-17",
      products: ["Pork"],
      locations: ["Plant 1"],
    },
  }, { fileName: "acme-coi.pdf" }, { sourceDocumentId: "document-123", sourceAttachmentKey: "abc123def456" });

  assertEquals(workflow.canonicalPath, "/FSQA/trellis/trading-partners/Acme Foods/Shared To Smithfield/Certificate of Insurance");
  assertEquals(workflow.targetName, "2026-09-17 - FoodLogiQ document-123 - Hash abc123def456 - acme-coi.pdf");
  assertEquals(workflow.requiredMetadata["Original Filename"], "acme-coi.pdf");
});

Deno.test("sourceFilingWorkflow rejects incomplete source metadata", () => {
  assertThrows(() => sourceFilingWorkflow({ supplier: {} }, { fileName: "coi.pdf" }, { sourceDocumentId: "document-123", sourceAttachmentKey: "abc123def456" }));
  assertThrows(() => sourceFilingWorkflow({
    supplier: { name: "Acme Foods" },
    source: { documentTypeName: "Certificate", effectiveDate: "2026-09-17" },
  }, {}, { sourceDocumentId: "document-123", sourceAttachmentKey: "abc123def456" }));
});

Deno.test("sourceFilingWorkflow retains source ticket identity", () => {
  const workflow = sourceFilingWorkflow({
    supplier: { name: "Acme Foods" },
    source: {
      documentTypeName: "Zendesk Ticket",
      effectiveDate: "2026-09-17",
      ticketSystem: "Zendesk",
      ticketId: "18427",
    },
  }, { fileName: "ticket.pdf" }, { sourceDocumentId: "document-123", sourceAttachmentKey: "abc123def456" });
  assertEquals(workflow.directorySegments.at(-1), "zendesk-18427");
});
