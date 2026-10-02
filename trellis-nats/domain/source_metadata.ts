import { filingWorkflow, type FilingMetadata, type FilingWorkflow } from "./filing.ts";

export function sourceFilingWorkflow(
  document: Record<string, unknown>,
  attachment: Record<string, unknown>,
  identity: { sourceDocumentId: string; sourceAttachmentKey: string },
): FilingWorkflow {
  const filing = object(document, "filing");
  if (Object.keys(filing).length > 0) {
    const filingDocument = object(filing, "document");
    return filingWorkflow({
      entity: requiredString(object(filing, "supplier"), "name", "Entity"),
      documentType: requiredString(filingDocument, "documentTypeName", "Document Type"),
      documentDate: requiredString(filingDocument, "documentDate", "Document Date"),
      sourceDocumentId: identity.sourceDocumentId,
      sourceAttachmentKey: identity.sourceAttachmentKey,
      expirationDate: optionalString(filingDocument, "expirationDate"),
      originalFilename: requiredString(attachment, "fileName", "Original Filename"),
      products: stringValues(filingDocument.products),
      locations: stringValues(filingDocument.locations),
      ticketSystem: optionalString(filingDocument, "ticketSystem"),
      ticketId: optionalString(filingDocument, "ticketId"),
    } satisfies FilingMetadata);
  }
  return filingWorkflow({
    entity: requiredString(object(document, "supplier"), "name", "Entity"),
    documentType: requiredString(
      object(document, "source"),
      "documentTypeName",
      "Document Type",
    ),
    documentDate: requiredString(
      object(document, "source"),
      "effectiveDate",
      "Document Date",
    ),
    sourceDocumentId: identity.sourceDocumentId,
    sourceAttachmentKey: identity.sourceAttachmentKey,
    expirationDate: optionalString(object(document, "source"), "expirationDate"),
    originalFilename: requiredString(attachment, "fileName", "Original Filename"),
    products: stringValues(object(document, "source").products),
    locations: stringValues(object(document, "source").locations),
    ticketSystem: optionalString(object(document, "source"), "ticketSystem"),
    ticketId: optionalString(object(document, "source"), "ticketId"),
  } satisfies FilingMetadata);
}

function object(value: Record<string, unknown>, name: string): Record<string, unknown> {
  const nested = value[name];
  return nested !== null && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {};
}

function requiredString(
  value: Record<string, unknown>,
  name: string,
  field: string,
): string {
  const found = optionalString(value, name);
  if (!found) throw new Error(`${field} is required from the FoodLogiQ source`);
  return found;
}

function optionalString(
  value: Record<string, unknown>,
  name: string,
): string | undefined {
  const found = value[name];
  return typeof found === "string" && found.trim() ? found : undefined;
}

function stringValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === "string");
  if (values.length !== value.length) {
    throw new Error("FoodLogiQ multi-value metadata must contain only strings");
  }
  return values;
}
