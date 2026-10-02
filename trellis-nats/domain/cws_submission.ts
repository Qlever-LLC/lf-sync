import type { CwsDocumentInput, CwsEntry } from "../cws.ts";

export interface CwsSubmissionClient {
  createDocument(input: CwsDocumentInput): Promise<CwsEntry>;
  uploadBuffer(entryId: number, extension: string, bytes: Uint8Array): Promise<void>;
}

export type CwsSubmissionInput = CwsDocumentInput & {
  extension: string;
  bytes: Uint8Array;
  existingEntryId?: number;
};

/** Creates and uploads once; an existing immutable mapping always wins over a retry. */
export async function submitToCws(
  cws: CwsSubmissionClient,
  input: CwsSubmissionInput,
): Promise<{ entryId: number; created: boolean; entry?: CwsEntry }> {
  if (input.existingEntryId !== undefined) {
    return { entryId: input.existingEntryId, created: false };
  }
  const document = await cws.createDocument({
    directoryPath: input.directoryPath,
    name: input.name,
    contentType: input.contentType,
    metadata: input.metadata,
    ...(input.template ? { template: input.template } : {}),
    ...(input.volume ? { volume: input.volume } : {}),
  });
  await cws.uploadBuffer(document.entryId, input.extension, input.bytes);
  return { entryId: document.entryId, created: true, entry: document };
}
