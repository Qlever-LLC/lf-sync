import type { CwsDocumentInput, CwsEntry } from "../cws.ts";

export interface CwsSubmissionClient {
  createDocument(
    input: CwsDocumentInput,
    guard?: () => Promise<void>,
  ): Promise<CwsEntry>;
  uploadBuffer(
    entryId: number,
    extension: string,
    bytes: Uint8Array,
    guard?: () => Promise<void>,
  ): Promise<void>;
}

export type CwsSubmissionInput = CwsDocumentInput & {
  extension: string;
  bytes: Uint8Array;
  existingEntryId?: number;
  guard?: () => Promise<void>;
  checkpointEntry?: (entry: CwsEntry) => Promise<void>;
  completeUpload?: () => Promise<void>;
};

/** Checkpoints a new entry before upload; mapped retries upload to that same entry. */
export async function submitToCws(
  cws: CwsSubmissionClient,
  input: CwsSubmissionInput,
): Promise<{ entryId: number; created: boolean; entry?: CwsEntry }> {
  await input.guard?.();
  const document = input.existingEntryId === undefined
    ? await cws.createDocument(
      {
        directoryPath: input.directoryPath,
        name: input.name,
        contentType: input.contentType,
        metadata: input.metadata,
        ...(input.template ? { template: input.template } : {}),
        ...(input.volume ? { volume: input.volume } : {}),
      },
      input.guard,
    )
    : undefined;
  if (document) await input.checkpointEntry?.(document);
  const entryId = document?.entryId ?? input.existingEntryId!;
  await input.guard?.();
  await cws.uploadBuffer(entryId, input.extension, input.bytes, input.guard);
  await input.completeUpload?.();
  await input.guard?.();
  return {
    entryId,
    created: Boolean(document),
    ...(document ? { entry: document } : {}),
  };
}
