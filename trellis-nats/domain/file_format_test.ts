import { assertEquals } from "jsr:@std/assert@1.0.16";
import { validateAttachmentFormat } from "./file_format.ts";

Deno.test("validateAttachmentFormat accepts matching PDF metadata", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "certificate.pdf",
      declaredContentType: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
    }),
    {
      declaredExtension: "pdf",
      declaredContentType: "application/pdf",
      detected: { contentType: "application/pdf", extension: "pdf" },
      selectedExtension: "pdf",
      confidence: "verified",
      reviewRequired: false,
    },
  );
});

Deno.test("validateAttachmentFormat requires review for conflicting or unknown bytes", () => {
  const mismatch = validateAttachmentFormat({
    filename: "certificate.pdf",
    declaredContentType: "application/pdf",
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  });
  assertEquals(mismatch.reviewRequired, true);
  assertEquals(
    mismatch.reason,
    "Filename extension does not match detected file bytes",
  );

  const unknown = validateAttachmentFormat({
    filename: "certificate",
    bytes: new Uint8Array([0, 1, 2, 3]),
  });
  assertEquals(unknown.reviewRequired, true);
  assertEquals(unknown.selectedExtension, undefined);
});

Deno.test("validateAttachmentFormat archives unknown non-empty bytes with a safe extension", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "legacy.xyz",
      declaredContentType: "application/octet-stream",
      bytes: new Uint8Array([0, 1, 2, 3]),
    }),
    {
      declaredExtension: "xyz",
      declaredContentType: undefined,
      detected: { contentType: "application/octet-stream", extension: "xyz" },
      selectedExtension: "xyz",
      confidence: "unverified",
      reviewRequired: false,
      reviewCode: "unverified-format",
    },
  );
});

Deno.test("validateAttachmentFormat accepts Excel workbook bytes", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "nutrition.xls",
      declaredContentType: "application/octet-stream",
      bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    }),
    {
      declaredExtension: "xls",
      declaredContentType: undefined,
      detected: { contentType: "application/vnd.ms-excel", extension: "xls" },
      selectedExtension: "xls",
      confidence: "verified",
      reviewRequired: false,
    },
  );

  const markers = new TextEncoder().encode(
    "PK\x03\x04 [Content_Types].xml xl/workbook.xml",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "nutrition.xlsx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: markers,
    }),
    {
      declaredExtension: "xlsx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      detected: {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      },
      selectedExtension: "xlsx",
      confidence: "verified",
      reviewRequired: false,
    },
  );
});

Deno.test("validateAttachmentFormat falls back for arbitrary zip files with safe extension", () => {
  const result = validateAttachmentFormat({
    filename: "nutrition.xlsx",
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]),
  });
  assertEquals(result.reviewRequired, false);
  assertEquals(result.selectedExtension, "xlsx");
  assertEquals(result.confidence, "unverified");
});

Deno.test("validateAttachmentFormat accepts Word document bytes", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "spec.doc",
      declaredContentType: "application/octet-stream",
      bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    }),
    {
      declaredExtension: "doc",
      declaredContentType: undefined,
      detected: { contentType: "application/msword", extension: "doc" },
      selectedExtension: "doc",
      confidence: "verified",
      reviewRequired: false,
    },
  );

  const markers = new TextEncoder().encode(
    "PK\x03\x04 [Content_Types].xml word/document.xml",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "spec.docx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: markers,
    }),
    {
      declaredExtension: "docx",
      declaredContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      detected: {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      },
      selectedExtension: "docx",
      confidence: "verified",
      reviewRequired: false,
    },
  );
});

Deno.test("validateAttachmentFormat accepts CSV text bytes", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "nutrition.csv",
      declaredContentType: "application/octet-stream",
      bytes: new TextEncoder().encode("sku,description\n123,Burgundy salt\n"),
    }),
    {
      declaredExtension: "csv",
      declaredContentType: undefined,
      detected: { contentType: "text/csv", extension: "csv" },
      selectedExtension: "csv",
      confidence: "verified",
      reviewRequired: false,
    },
  );
});

Deno.test("validateAttachmentFormat accepts additional archival formats", () => {
  assertEquals(
    validateAttachmentFormat({
      filename: "statement.rtf",
      bytes: new TextEncoder().encode("{\\rtf1\\ansi statement}"),
    }).selectedExtension,
    "rtf",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "image.bmp",
      bytes: new Uint8Array([0x42, 0x4d, 1, 2]),
    }).selectedExtension,
    "bmp",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "template.dotx",
      bytes: new TextEncoder().encode(
        "PK\x03\x04 [Content_Types].xml word/document.xml",
      ),
    }).selectedExtension,
    "dotx",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "slides.pptx",
      bytes: new TextEncoder().encode(
        "PK\x03\x04 [Content_Types].xml ppt/presentation.xml",
      ),
    }).selectedExtension,
    "pptx",
  );
  assertEquals(
    validateAttachmentFormat({
      filename: "shortcut.url",
      bytes: new TextEncoder().encode(
        "[InternetShortcut]\nURL=https://example.com\n",
      ),
    }).selectedExtension,
    "url",
  );
});
