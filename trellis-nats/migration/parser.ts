import type {
  CandidateClassification,
  CandidateRecord,
  JsonObject,
  LegacyAttachment,
  LegacyJob,
  SourceMapping,
} from "./types.ts";

export function parseLegacyJob(
  path: string,
  raw: JsonObject,
): LegacyJob | null {
  const sourceRef = stringAt(raw, [
    "sourceRef",
    "sourcePath",
    "source",
    "documentPath",
  ]);
  const rawAttachments = arrayAt(raw, [
    "attachments",
    "vdocs",
    "documents",
    "files",
  ]);
  if (!sourceRef && !rawAttachments) return null;
  const attachments = (rawAttachments ?? []).flatMap((value, index) =>
    parseAttachment(value, index)
  );
  return { legacyJobPath: path, legacySourceRef: sourceRef, attachments, raw };
}

export function candidateFromJob(
  job: LegacyJob,
  mappings: ReadonlyMap<string, SourceMapping>,
): CandidateRecord {
  const mapping = job.legacySourceRef
    ? mappings.get(job.legacySourceRef)
    : undefined;
  const reasons: string[] = [];
  let classification: CandidateClassification = "safe-to-submit";
  if (!job.legacySourceRef || !mapping) {
    classification = "missing-source";
    reasons.push(
      "No explicit source mapping exists for the legacy source reference.",
    );
  } else if (job.attachments.length === 0) {
    classification = "invalid-payload";
    reasons.push("The legacy job has no parseable attachment records.");
  } else if (
    new Set(job.attachments.map((attachment) => attachment.vdocKey)).size !==
      job.attachments.length
  ) {
    classification = "ambiguous-entry";
    reasons.push("Multiple legacy attachments resolve to the same vdoc key.");
  } else if (
    job.attachments.some((attachment) =>
      !attachment.byteReference || !attachment.contentType
    )
  ) {
    classification = "invalid-payload";
    reasons.push("An attachment has no byte reference or content type.");
  } else if (
    job.attachments.some((attachment) =>
      attachment.entryId && !attachment.repository
    )
  ) {
    classification = "manual-review";
    reasons.push("A legacy entry id has no repository identity.");
  } else if (isCompleted(job.raw)) {
    classification = "already-completed";
    reasons.push("The legacy job reports a terminal completed state.");
  } else if (job.attachments.some((attachment) => attachment.entryId)) {
    classification = "adopt-existing-entry";
    reasons.push("The legacy job identifies an existing destination entry.");
  }
  return {
    kind: "legacy-oada-candidate",
    // A document/vdoc identity is stable even when a legacy index contains duplicate job references.
    candidateKey: stableKey(
      `${mapping?.sourceSystem ?? ""}\n${
        mapping?.sourceId ?? job.legacySourceRef ?? ""
      }\n${mapping?.sourceVersion ?? ""}\n${
        job.attachments.map((attachment) => attachment.vdocKey).sort().join(
          "\n",
        )
      }`,
    ),
    classification,
    legacyJobPath: job.legacyJobPath,
    ...(mapping ? { mapping } : {}),
    attachments: [...job.attachments].sort((a, b) =>
      a.vdocKey.localeCompare(b.vdocKey)
    ),
    reasons,
    provenance: {
      legacyJobPath: job.legacyJobPath,
      legacySourceRef: job.legacySourceRef ?? null,
    },
  };
}

export function loadSourceMappings(
  records: readonly JsonObject[],
): Map<string, SourceMapping> {
  const mappings = new Map<string, SourceMapping>();
  for (const record of records) {
    const fields = [
      "legacySourceRef",
      "sourceSystem",
      "sourceId",
      "sourceVersion",
      "sourcePath",
    ] as const;
    if (
      fields.some((field) =>
        typeof record[field] !== "string" || !record[field].trim()
      )
    ) {
      throw new Error(
        "Every source mapping must include legacySourceRef, sourceSystem, sourceId, sourceVersion, and sourcePath",
      );
    }
    const mapping = record as SourceMapping;
    if (mappings.has(mapping.legacySourceRef)) {
      throw new Error(`Duplicate source mapping: ${mapping.legacySourceRef}`);
    }
    mappings.set(mapping.legacySourceRef, mapping);
  }
  return mappings;
}

export function stableKey(value: string): string {
  // This reversible byte encoding cannot silently collide like a short hash.
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return `legacy-${
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
  }`;
}

function parseAttachment(value: unknown, index: number): LegacyAttachment[] {
  if (!isObject(value)) return [];
  const vdocKey = stringAt(value, ["vdocKey", "key", "name", "id"]);
  const byteReference = stringAt(value, [
    "byteReference",
    "href",
    "path",
    "url",
  ]);
  const contentType = stringAt(value, ["contentType", "mimeType", "type"]) ??
    "application/octet-stream";
  if (!vdocKey || !byteReference) return [];
  return [{
    vdocKey: vdocKey || `attachment-${index}`,
    byteReference,
    contentType,
    ...(stringAt(value, ["fileName", "filename"])
      ? { fileName: stringAt(value, ["fileName", "filename"]) }
      : {}),
    ...(stringAt(value, ["entryId", "entry_id"])
      ? { entryId: stringAt(value, ["entryId", "entry_id"]) }
      : {}),
    ...(stringAt(value, ["repository", "repo"])
      ? { repository: stringAt(value, ["repository", "repo"]) }
      : {}),
    ...(stringAt(value, ["targetPath", "path"])
      ? { targetPath: stringAt(value, ["targetPath", "path"]) }
      : {}),
    ...(stringAt(value, ["targetName", "name"])
      ? { targetName: stringAt(value, ["targetName", "name"]) }
      : {}),
    ...(isObject(value.payload) ? { payload: value.payload } : {}),
  }];
}

function stringAt(
  value: JsonObject,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    if (typeof value[field] === "string" && value[field].trim()) {
      return value[field] as string;
    }
  }
}
function arrayAt(
  value: JsonObject,
  fields: readonly string[],
): readonly unknown[] | undefined {
  for (const field of fields) {
    if (Array.isArray(value[field])) {
      return value[field] as readonly unknown[];
    }
  }
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompleted(value: JsonObject): boolean {
  const status = stringAt(value, ["status", "state", "result"]);
  return ["completed", "succeeded", "done"].includes(
    status?.toLowerCase() ?? "",
  );
}
