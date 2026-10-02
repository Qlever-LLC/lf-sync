import type { CwsDirectory } from "../cws.ts";

export interface DirectoryMappingStore {
  upsertVerified(input: {
    repository: string;
    canonicalPath: string;
    parentDirectoryId?: string | null;
    cwsEntryId: string;
    name: string;
    metadata?: Record<string, unknown>;
    verifiedAt?: Date;
  }): Promise<{ id: string }>;
}

/** Reconciles a canonical CWS path and persists every segment's verified entry ID. */
export async function reconcileDirectory(
  cws: { ensureDirectory(path: string): Promise<CwsDirectory> },
  directories: DirectoryMappingStore,
  repository: string,
  canonicalPath: string,
): Promise<{ directoryId: string; cwsEntryId: string }> {
  const resolved = await cws.ensureDirectory(canonicalPath);
  let parentDirectoryId: string | null = null;
  let currentPath = "";
  let final: { id: string; cwsEntryId: string } | undefined;
  for (const entry of resolved.entries) {
    currentPath += `/${entry.name}`;
    const record = await directories.upsertVerified({
      repository,
      canonicalPath: currentPath,
      parentDirectoryId,
      cwsEntryId: String(entry.entryId),
      name: entry.name,
      metadata: { cwsType: entry.type, cwsPath: entry.path },
    });
    parentDirectoryId = record.id;
    final = { id: record.id, cwsEntryId: String(entry.entryId) };
  }
  if (!final) throw new Error("CWS directory reconciliation returned no entries");
  return { directoryId: final.id, cwsEntryId: final.cwsEntryId };
}
