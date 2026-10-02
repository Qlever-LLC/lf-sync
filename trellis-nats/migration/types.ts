export type JsonObject = Readonly<Record<string, unknown>>;

export type CandidateClassification =
  | "already-completed"
  | "safe-to-submit"
  | "adopt-existing-entry"
  | "missing-source"
  | "invalid-payload"
  | "ambiguous-entry"
  | "manual-review";

export interface SourceMapping extends JsonObject {
  legacySourceRef: string;
  sourceSystem: string;
  sourceId: string;
  sourceVersion: string;
  sourcePath: string;
  documentType?: string;
}

export interface LegacyAttachment extends JsonObject {
  vdocKey: string;
  byteReference: string;
  contentType: string;
  fileName?: string;
  entryId?: string;
  repository?: string;
  targetPath?: string;
  targetName?: string;
  payload?: JsonObject;
}

export interface LegacyJob extends JsonObject {
  legacyJobPath: string;
  legacySourceRef?: string;
  attachments: readonly LegacyAttachment[];
  raw: JsonObject;
}

export interface CandidateRecord extends JsonObject {
  kind: "legacy-oada-candidate";
  candidateKey: string;
  classification: CandidateClassification;
  legacyJobPath: string;
  mapping?: SourceMapping;
  attachments: readonly LegacyAttachment[];
  reasons: readonly string[];
  provenance: JsonObject;
}

export interface LegacyOadaReader {
  getJson(path: string): Promise<JsonObject>;
  getBytes(path: string): Promise<Uint8Array>;
}
