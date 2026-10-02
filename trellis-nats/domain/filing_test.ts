import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.16";
import { filingWorkflow } from "./filing.ts";

Deno.test("filingWorkflow creates the canonical FoodLogiQ location and metadata", () => {
  const workflow = filingWorkflow({
    entity: "  Acme   Foods ",
    documentType: "Certificate of Insurance",
    documentDate: "2026-09-17T09:30:00Z",
    sourceDocumentId: "doc-123",
    sourceAttachmentKey: "abc123def456",
    expirationDate: "2027-09-17",
    originalFilename: "acme-coi.pdf",
    products: ["Pork", "Poultry"],
    locations: ["Plant 1"],
  });

  assertEquals(workflow, {
    canonicalPath: "/FSQA/trellis/trading-partners/Acme Foods/Shared To Smithfield/Certificate of Insurance",
    directorySegments: ["FSQA", "trellis", "trading-partners", "Acme Foods", "Shared To Smithfield", "Certificate of Insurance"],
    targetName: "2026-09-17 - FoodLogiQ doc-123 - Hash abc123def456 - acme-coi.pdf",
    requiredMetadata: {
      Entity: "Acme Foods",
      "Document Type": "Certificate of Insurance",
      "Share Mode": "Shared To Smithfield",
      "Document Date": "2026-09-17",
      "Expiration Date": "2027-09-17",
      Products: ["Pork", "Poultry"],
      Locations: ["Plant 1"],
      "Original Filename": "acme-coi.pdf",
    },
  });
});

Deno.test("filingWorkflow rejects unsafe path values and invalid dates", () => {
  const valid = {
    entity: "Acme Foods",
    documentType: "Certificate",
    documentDate: "2026-09-17",
    sourceDocumentId: "doc-123",
    sourceAttachmentKey: "abc123def456",
    originalFilename: "coi.pdf",
  };
  assertThrows(() => filingWorkflow({ ...valid, entity: "../Acme" }));
  assertThrows(() => filingWorkflow({ ...valid, originalFilename: "nested/coi.pdf" }));
  assertThrows(() => filingWorkflow({ ...valid, documentDate: "2026-02-30" }));
});

Deno.test("filingWorkflow allows slashes in product and location metadata", () => {
  const workflow = filingWorkflow({
    entity: "Acme Foods",
    documentType: "Product Specification",
    documentDate: "2026-09-17",
    sourceDocumentId: "doc-123",
    sourceAttachmentKey: "abc123def456",
    originalFilename: "spec.pdf",
    products: ["1/4\" Diced Red Bell Peppers", "MB 70L / 495"],
    locations: ["Venture Foods / Kara Foods - Fond du Lac"],
  });

  assertEquals(workflow.requiredMetadata.Products, [
    "1/4\" Diced Red Bell Peppers",
    "MB 70L / 495",
  ]);
  assertEquals(workflow.requiredMetadata.Locations, [
    "Venture Foods / Kara Foods - Fond du Lac",
  ]);
});

Deno.test("filingWorkflow allows slashes in document type metadata but not folder paths", () => {
  const workflow = filingWorkflow({
    entity: "Acme Foods",
    documentType: "HACCP Plan / Flow Chart",
    documentDate: "2026-09-17",
    sourceDocumentId: "doc-123",
    sourceAttachmentKey: "abc123def456",
    originalFilename: "haccp.pdf",
  });

  assertEquals(
    workflow.canonicalPath,
    "/FSQA/trellis/trading-partners/Acme Foods/Shared To Smithfield/HACCP Plan - Flow Chart",
  );
  assertEquals(workflow.requiredMetadata["Document Type"], "HACCP Plan / Flow Chart");
});

Deno.test("filingWorkflow puts ticket documents and attachments in a ticket directory", () => {
  const workflow = filingWorkflow({
    entity: "Acme Foods",
    documentType: "Zendesk Ticket",
    documentDate: "2026-09-17",
    sourceDocumentId: "doc-123",
    sourceAttachmentKey: "abc123def456",
    originalFilename: "invoice.pdf",
    ticketSystem: "Zendesk",
    ticketId: "18427",
  });

  assertEquals(
    workflow.canonicalPath,
    "/FSQA/trellis/trading-partners/Acme Foods/Shared To Smithfield/Zendesk Ticket/zendesk-18427",
  );
  assertEquals(workflow.requiredMetadata["Ticket System"], "Zendesk");
  assertEquals(workflow.requiredMetadata["Ticket ID"], "18427");
});
