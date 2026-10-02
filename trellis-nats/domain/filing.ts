export type FilingMetadata = {
  entity: string;
  documentType: string;
  documentDate: string;
  sourceDocumentId: string;
  sourceAttachmentKey: string;
  originalFilename: string;
  expirationDate?: string;
  products?: readonly string[];
  locations?: readonly string[];
  ticketSystem?: string;
  ticketId?: string;
};

export type FilingWorkflow = {
  canonicalPath: string;
  directorySegments: readonly string[];
  targetName: string;
  requiredMetadata: Record<string, string | string[]>;
};

const ROOT_SEGMENTS = ["FSQA", "trellis", "trading-partners"] as const;
const SHARE_MODE = "Shared To Smithfield";

export function filingWorkflow(metadata: FilingMetadata): FilingWorkflow {
  const entity = safeSegment(metadata.entity, "Entity");
  const documentType = metadataValue(metadata.documentType, "Document Type");
  const documentTypeDirectory = safeDirectorySegment(documentType, "Document Type");
  const documentDate = normalizedDate(metadata.documentDate, "Document Date");
  const originalFilename = safeSegment(metadata.originalFilename, "Original Filename");
  const sourceDocumentId = safeSegment(metadata.sourceDocumentId, "FoodLogiQ Document ID");
  const sourceAttachmentKey = safeSegment(metadata.sourceAttachmentKey, "FoodLogiQ Attachment Key");
  const targetName = safeSegment(
    `${documentDate} - FoodLogiQ ${sourceDocumentId} - Hash ${sourceAttachmentKey} - ${originalFilename}`,
    "Target Filename",
  );
  const expirationDate = metadata.expirationDate === undefined
    ? undefined
    : normalizedDate(metadata.expirationDate, "Expiration Date");
  const products = normalizedValues(metadata.products, "Products");
  const locations = normalizedValues(metadata.locations, "Locations");
  const ticket = ticketDirectory(metadata.ticketSystem, metadata.ticketId);
  const directorySegments = [
    ...ROOT_SEGMENTS,
    entity,
    SHARE_MODE,
    documentTypeDirectory,
    ...(ticket ? [ticket.directory] : []),
  ];

  return {
    canonicalPath: `/${directorySegments.join("/")}`,
    directorySegments,
    targetName,
    requiredMetadata: {
      Entity: entity,
      "Document Type": documentType,
      "Share Mode": SHARE_MODE,
      "Document Date": documentDate,
      ...(expirationDate === undefined ? {} : { "Expiration Date": expirationDate }),
      ...(products.length === 0 ? {} : { Products: products }),
      ...(locations.length === 0 ? {} : { Locations: locations }),
      ...(ticket ? { "Ticket System": ticket.system, "Ticket ID": ticket.id } : {}),
      "Original Filename": originalFilename,
    },
  };
}

function ticketDirectory(
  system: string | undefined,
  id: string | undefined,
): { directory: string; system: string; id: string } | undefined {
  if (system === undefined && id === undefined) return undefined;
  if (system === undefined || id === undefined) {
    throw new Error("Ticket System and Ticket ID must be provided together");
  }
  const normalizedSystem = safeSegment(system, "Ticket System");
  const normalizedId = safeSegment(id, "Ticket ID");
  const slug = normalizedSystem.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (!slug) throw new Error("Ticket System contains no usable directory characters");
  return {
    directory: `${slug}-${normalizedId}`,
    system: normalizedSystem,
    id: normalizedId,
  };
}

function safeDirectorySegment(value: string, field: string): string {
  return safeSegment(value.replaceAll(/[\\/]+/g, " - "), field);
}

function safeSegment(value: string, field: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  if (!normalized) throw new Error(`${field} is required`);
  if (
    normalized === "." || normalized === ".." ||
    /[\\/\0\r\n]/.test(normalized)
  ) {
    throw new Error(`${field} contains an unsafe path segment`);
  }
  return normalized;
}

function normalizedDate(value: string, field: string): string {
  const normalized = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(normalized);
  if (!match || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} must be an ISO date or timestamp`);
  }
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== match[1]) {
    throw new Error(`${field} must be a valid calendar date`);
  }
  return match[1];
}

function normalizedValues(
  values: readonly string[] | undefined,
  field: string,
): string[] {
  if (!values) return [];
  return values.map((value) => metadataValue(value, field));
}

function metadataValue(value: string, field: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  if (!normalized) throw new Error(`${field} contains an empty value`);
  if (/[\0\r\n]/.test(normalized)) {
    throw new Error(`${field} contains unsafe control characters`);
  }
  return normalized;
}
