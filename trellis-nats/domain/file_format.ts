export type DetectedFileFormat = {
  contentType: string;
  extension: string;
};

export type AttachmentFormatInput = {
  filename: string;
  declaredContentType?: string | null;
  bytes: Uint8Array;
};

export type AttachmentFormatValidation = {
  declaredExtension: string | undefined;
  declaredContentType: string | undefined;
  detected: DetectedFileFormat | undefined;
  selectedExtension: string | undefined;
  confidence: "verified" | "unverified";
  reviewRequired: boolean;
  reason?: string;
  reviewCode?: string;
};

const FORMATS:
  readonly (DetectedFileFormat & { signature: readonly number[] })[] = [
    {
      contentType: "application/pdf",
      extension: "pdf",
      signature: [0x25, 0x50, 0x44, 0x46, 0x2d],
    },
    {
      contentType: "image/jpeg",
      extension: "jpg",
      signature: [0xff, 0xd8, 0xff],
    },
    {
      contentType: "image/png",
      extension: "png",
      signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    },
    {
      contentType: "image/gif",
      extension: "gif",
      signature: [0x47, 0x49, 0x46, 0x38],
    },
    {
      contentType: "image/tiff",
      extension: "tif",
      signature: [0x49, 0x49, 0x2a, 0x00],
    },
    {
      contentType: "image/tiff",
      extension: "tif",
      signature: [0x4d, 0x4d, 0x00, 0x2a],
    },
  ];

const XLS_CONTENT_TYPE = "application/vnd.ms-excel";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOC_CONTENT_TYPE = "application/msword";
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const RTF_CONTENT_TYPE = "application/rtf";
const BMP_CONTENT_TYPE = "image/bmp";
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
const URL_CONTENT_TYPE = "application/internet-shortcut";
const CSV_CONTENT_TYPE = "text/csv";
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/tif": "image/tiff",
  "application/xls": XLS_CONTENT_TYPE,
  "application/excel": XLS_CONTENT_TYPE,
  "application/x-excel": XLS_CONTENT_TYPE,
  "application/vnd.ms-office": XLS_CONTENT_TYPE,
  "application/xlsx": XLSX_CONTENT_TYPE,
  "application/doc": DOC_CONTENT_TYPE,
  "application/ms-doc": DOC_CONTENT_TYPE,
  "application/vnd.ms-word": DOC_CONTENT_TYPE,
  "application/docx": DOCX_CONTENT_TYPE,
  "text/rtf": RTF_CONTENT_TYPE,
  "application/x-rtf": RTF_CONTENT_TYPE,
  "image/x-ms-bmp": BMP_CONTENT_TYPE,
  "image/x-bmp": BMP_CONTENT_TYPE,
  "application/pptx": PPTX_CONTENT_TYPE,
  "application/dotx": DOTX_CONTENT_TYPE,
  "application/x-mswinurl": URL_CONTENT_TYPE,
  "application/csv": CSV_CONTENT_TYPE,
  "text/comma-separated-values": CSV_CONTENT_TYPE,
};

const NON_AUTHORITATIVE_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

const EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  jpeg: "jpg",
  tiff: "tif",
};

export function validateAttachmentFormat(
  input: AttachmentFormatInput,
): AttachmentFormatValidation {
  const declaredExtension = extension(input.filename);
  const declaredContentType = normalizeContentType(input.declaredContentType);
  const detected = detectFormat(input.bytes, declaredExtension);

  if (!detected) {
    const fallback = fallbackFormat(
      input.bytes,
      declaredExtension,
      declaredContentType,
    );
    if (fallback) return fallback;
    return review(
      declaredExtension,
      declaredContentType,
      undefined,
      "File bytes have an unrecognized format",
      "unrecognized-format",
    );
  }
  const normalizedDeclaredExtension = declaredExtension &&
    (EXTENSION_ALIASES[declaredExtension] ?? declaredExtension);
  const normalizedDeclaredContentType = declaredContentType &&
    (MIME_ALIASES[declaredContentType] ?? declaredContentType);
  if (
    normalizedDeclaredExtension !== undefined &&
    normalizedDeclaredExtension !== detected.extension
  ) {
    return review(
      declaredExtension,
      declaredContentType,
      detected,
      "Filename extension does not match detected file bytes",
      "extension-mismatch",
    );
  }
  if (
    normalizedDeclaredContentType !== undefined &&
    normalizedDeclaredContentType !== detected.contentType
  ) {
    return review(
      declaredExtension,
      declaredContentType,
      detected,
      "Declared content type does not match detected file bytes",
      "content-type-mismatch",
    );
  }
  return {
    declaredExtension,
    declaredContentType,
    detected: {
      contentType: detected.contentType,
      extension: detected.extension,
    },
    selectedExtension: detected.extension,
    confidence: "verified",
    reviewRequired: false,
  };
}

function detectFormat(
  bytes: Uint8Array,
  declaredExtension: string | undefined,
): DetectedFileFormat | undefined {
  const detected = FORMATS.find((format) => hasPrefix(bytes, format.signature));
  if (detected) {
    return { contentType: detected.contentType, extension: detected.extension };
  }
  if (declaredExtension === "xls" && hasPrefix(bytes, XLS_SIGNATURE)) {
    return { contentType: XLS_CONTENT_TYPE, extension: "xls" };
  }
  if (declaredExtension === "doc" && hasPrefix(bytes, XLS_SIGNATURE)) {
    return { contentType: DOC_CONTENT_TYPE, extension: "doc" };
  }
  if (
    declaredExtension === "rtf" &&
    hasPrefix(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])
  ) {
    return { contentType: RTF_CONTENT_TYPE, extension: "rtf" };
  }
  if (declaredExtension === "bmp" && hasPrefix(bytes, [0x42, 0x4d])) {
    return { contentType: BMP_CONTENT_TYPE, extension: "bmp" };
  }
  if (
    declaredExtension === "xlsx" && hasPrefix(bytes, ZIP_SIGNATURE) &&
    hasAscii(bytes, "[Content_Types].xml") && hasAscii(bytes, "xl/workbook.xml")
  ) {
    return { contentType: XLSX_CONTENT_TYPE, extension: "xlsx" };
  }
  if (
    declaredExtension === "docx" && hasPrefix(bytes, ZIP_SIGNATURE) &&
    hasAscii(bytes, "[Content_Types].xml") &&
    hasAscii(bytes, "word/document.xml")
  ) {
    return { contentType: DOCX_CONTENT_TYPE, extension: "docx" };
  }
  if (
    declaredExtension === "dotx" && hasPrefix(bytes, ZIP_SIGNATURE) &&
    hasAscii(bytes, "[Content_Types].xml") &&
    hasAscii(bytes, "word/document.xml")
  ) {
    return { contentType: DOTX_CONTENT_TYPE, extension: "dotx" };
  }
  if (
    declaredExtension === "pptx" && hasPrefix(bytes, ZIP_SIGNATURE) &&
    hasAscii(bytes, "[Content_Types].xml") &&
    hasAscii(bytes, "ppt/presentation.xml")
  ) {
    return { contentType: PPTX_CONTENT_TYPE, extension: "pptx" };
  }
  if (declaredExtension === "csv" && looksLikeText(bytes)) {
    return { contentType: CSV_CONTENT_TYPE, extension: "csv" };
  }
  if (
    declaredExtension === "url" && looksLikeText(bytes) &&
    hasAscii(bytes, "[InternetShortcut]") && hasAscii(bytes, "URL=")
  ) {
    return { contentType: URL_CONTENT_TYPE, extension: "url" };
  }
  return undefined;
}

function fallbackFormat(
  bytes: Uint8Array,
  declaredExtension: string | undefined,
  declaredContentType: string | undefined,
): AttachmentFormatValidation | undefined {
  if (
    bytes.byteLength === 0 || !declaredExtension ||
    !safeExtension(declaredExtension)
  ) return undefined;
  return {
    declaredExtension,
    declaredContentType,
    detected: {
      contentType: declaredContentType ?? FALLBACK_CONTENT_TYPE,
      extension: declaredExtension,
    },
    selectedExtension: declaredExtension,
    confidence: "unverified",
    reviewRequired: false,
    reviewCode: "unverified-format",
  };
}

function safeExtension(value: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(value);
}

function normalizeContentType(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized || NON_AUTHORITATIVE_CONTENT_TYPES.has(normalized)) {
    return undefined;
  }
  return MIME_ALIASES[normalized] ?? normalized;
}

function extension(filename: string): string | undefined {
  const name = filename.trim();
  const separator = name.lastIndexOf(".");
  if (separator <= 0 || separator === name.length - 1) return undefined;
  return name.slice(separator + 1).toLowerCase();
}

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  outer: for (
    let index = 0;
    index <= bytes.length - needle.length;
    index += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  const sampleLength = Math.min(bytes.byteLength, 4096);
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = bytes[index] ?? 0;
    if (byte === 0) return false;
    if (byte < 0x09) return false;
    if (byte > 0x0d && byte < 0x20) return false;
  }
  return true;
}

function review(
  declaredExtension: string | undefined,
  declaredContentType: string | undefined,
  detected: DetectedFileFormat | undefined,
  reason: string,
  reviewCode: string,
): AttachmentFormatValidation {
  return {
    declaredExtension,
    declaredContentType,
    detected: detected &&
      { contentType: detected.contentType, extension: detected.extension },
    selectedExtension: undefined,
    confidence: "verified",
    reviewRequired: true,
    reason,
    reviewCode,
  };
}
