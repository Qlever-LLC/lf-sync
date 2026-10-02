export type LaserficheEntry = {
  id: number;
  name: string;
  entryType: string;
  parentId?: number;
  fullPath?: string;
  folderPath?: string;
  isContainer?: boolean;
  isLeaf?: boolean;
};

export type LaserficheDirectory = {
  canonicalPath: string;
  entries: readonly LaserficheEntry[];
};

export type LaserficheAccessToken = {
  accessToken: string;
  tokenType?: string;
  expiresAt?: Date;
};

export type LaserficheAccessTokenRequest = {
  forceRefresh: boolean;
};

export type LaserficheAccessTokenProvider = (
  request: LaserficheAccessTokenRequest,
) => Promise<LaserficheAccessToken>;

export type LaserficheMutationGuard = (
  operation: string,
) => void | Promise<void>;

export type LaserficheRestClientOptions = {
  apiBaseUrl: string;
  repositoryId: string;
  getAccessToken: LaserficheAccessTokenProvider;
  rootEntryId?: number;
  requestTimeoutMs?: number;
  tokenExpirySkewMs?: number;
  mutationGuard?: LaserficheMutationGuard;
  fetch?: typeof fetch;
  now?: () => Date;
};
