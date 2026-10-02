import { errorFromResponse, LaserficheRestError } from "./errors.ts";
import type {
  LaserficheAccessToken,
  LaserficheDirectory,
  LaserficheEntry,
  LaserficheRestClientOptions,
} from "./types.ts";

type EntryResponse = {
  id?: unknown;
  name?: unknown;
  entryType?: unknown;
  parentId?: unknown;
  fullPath?: unknown;
  folderPath?: unknown;
  isContainer?: unknown;
  isLeaf?: unknown;
};

type EntryCollectionResponse = {
  value?: unknown;
  "@odata.nextLink"?: unknown;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_TOKEN_EXPIRY_SKEW_MS = 30_000;

export class LaserficheRestClient {
  private readonly apiBaseUrl: URL;
  private readonly fetchFn: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly tokenExpirySkewMs: number;
  private readonly rootEntryId: number;
  private readonly now: () => Date;
  private token?: LaserficheAccessToken;
  private tokenRequest?: Promise<LaserficheAccessToken>;

  constructor(private readonly options: LaserficheRestClientOptions) {
    this.apiBaseUrl = normalizedApiBaseUrl(options.apiBaseUrl);
    this.fetchFn = options.fetch ?? fetch;
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.tokenExpirySkewMs = nonNegativeInteger(
      options.tokenExpirySkewMs ?? DEFAULT_TOKEN_EXPIRY_SKEW_MS,
      "tokenExpirySkewMs",
    );
    this.rootEntryId = positiveInteger(options.rootEntryId ?? 1, "rootEntryId");
    this.now = options.now ?? (() => new Date());
    if (!options.repositoryId.trim()) {
      throw new TypeError("repositoryId is required");
    }
  }

  async getEntry(entryId: number): Promise<LaserficheEntry> {
    const id = positiveInteger(entryId, "entryId");
    const response = await this.request(
      "GetEntry",
      this.repositoryUrl(`Entries/${id}`),
    );
    return parseEntry(await responseJson(response, "GetEntry"), "GetEntry");
  }

  async listFolderChildren(entryId: number): Promise<LaserficheEntry[]> {
    const id = positiveInteger(entryId, "entryId");
    let url: URL | undefined = this.repositoryUrl(
      `Entries/${id}/Folder/Children`,
    );
    const entries: LaserficheEntry[] = [];
    while (url) {
      const response = await this.request("ListFolderChildren", url);
      const page = await responseJson(
        response,
        "ListFolderChildren",
      ) as EntryCollectionResponse;
      if (!Array.isArray(page.value)) {
        throw invalidResponse("ListFolderChildren", "entry-list");
      }
      entries.push(
        ...page.value.map((value) => parseEntry(value, "ListFolderChildren")),
      );
      url = this.nextLink(page["@odata.nextLink"], url);
    }
    return entries;
  }

  async createFolder(
    parentEntryId: number,
    name: string,
  ): Promise<LaserficheEntry> {
    const id = positiveInteger(parentEntryId, "parentEntryId");
    const folderName = requiredName(name);
    const response = await this.mutatingRequest(
      "CreateFolder",
      this.repositoryUrl(`Entries/${id}/Folder/Children`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryType: "Folder",
          name: folderName,
          autoRename: false,
        }),
      },
    );
    return parseEntry(
      await responseJson(response, "CreateFolder"),
      "CreateFolder",
    );
  }

  async ensureDirectory(canonicalPath: string): Promise<LaserficheDirectory> {
    const segments = directorySegments(canonicalPath);
    const entries: LaserficheEntry[] = [];
    let parentId = this.rootEntryId;
    for (const segment of segments) {
      let children = await this.listFolderChildren(parentId);
      let folder = matchingFolder(children, segment);
      if (!folder) {
        try {
          folder = await this.createFolder(parentId, segment);
        } catch (error) {
          if (
            !(error instanceof LaserficheRestError) || error.statusCode !== 409
          ) {
            throw error;
          }
          children = await this.listFolderChildren(parentId);
          folder = matchingFolder(children, segment);
          if (!folder) throw error;
        }
      }
      entries.push(folder);
      parentId = folder.id;
    }
    return { canonicalPath, entries };
  }

  private async request(
    operation: string,
    url: URL,
    init: RequestInit = {},
    retrying = false,
    mutation = false,
  ): Promise<Response> {
    if (mutation) await this.requireMutation(operation);
    const token = await this.accessToken(retrying);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          authorization: `${token.tokenType ?? "Bearer"} ${token.accessToken}`,
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new LaserficheRestError(operation, "request-failed");
    }
    if (response.status === 401 && !retrying) {
      this.token = undefined;
      return await this.request(operation, url, init, true, mutation);
    }
    if (!response.ok) throw await errorFromResponse(operation, response);
    return response;
  }

  private mutatingRequest(
    operation: string,
    url: URL,
    init: RequestInit,
  ): Promise<Response> {
    return this.request(operation, url, init, false, true);
  }

  private async accessToken(
    forceRefresh: boolean,
  ): Promise<LaserficheAccessToken> {
    if (!forceRefresh && this.tokenIsUsable(this.token)) return this.token;
    if (!this.tokenRequest) {
      this.tokenRequest = Promise.resolve()
        .then(() => this.options.getAccessToken({ forceRefresh }))
        .then((token) => validateToken(token))
        .catch((error: unknown) => {
          if (error instanceof LaserficheRestError) throw error;
          throw new LaserficheRestError(
            "GetAccessToken",
            "token-provider-failed",
          );
        })
        .finally(() => {
          this.tokenRequest = undefined;
        });
    }
    this.token = await this.tokenRequest;
    return this.token;
  }

  private tokenIsUsable(
    token: LaserficheAccessToken | undefined,
  ): token is LaserficheAccessToken {
    if (!token) return false;
    if (!token.expiresAt) return true;
    return token.expiresAt.getTime() - this.tokenExpirySkewMs >
      this.now().getTime();
  }

  private async requireMutation(operation: string): Promise<void> {
    if (!this.options.mutationGuard) {
      throw new LaserficheRestError(operation, "mutation-not-authorized");
    }
    await this.options.mutationGuard(operation);
  }

  private repositoryUrl(path: string): URL {
    return new URL(
      `v2/Repositories/${
        encodeURIComponent(this.options.repositoryId)
      }/${path}`,
      this.apiBaseUrl,
    );
  }

  private nextLink(value: unknown, currentUrl: URL): URL | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
      throw invalidResponse("ListFolderChildren", "next-link");
    }
    const next = new URL(value, currentUrl);
    if (
      next.origin !== this.apiBaseUrl.origin ||
      !next.pathname.startsWith(this.apiBaseUrl.pathname)
    ) {
      throw invalidResponse("ListFolderChildren", "unsafe-next-link");
    }
    return next;
  }
}

function normalizedApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("apiBaseUrl must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new TypeError(
      "apiBaseUrl must use HTTPS unless it targets localhost",
    );
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function requiredName(value: string): string {
  const name = value.trim();
  if (!name) throw new TypeError("Folder name is required");
  if (name.includes("/") || name.includes("\\")) {
    throw new TypeError("Folder name must be a single path segment");
  }
  return name;
}

function directorySegments(path: string): string[] {
  if (!path.startsWith("/")) {
    throw new TypeError("Directory path must be absolute");
  }
  const segments = path.split("/").filter(Boolean).map(requiredName);
  if (segments.length === 0) throw new TypeError("Directory path is required");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("Directory path cannot contain relative segments");
  }
  return segments;
}

function matchingFolder(
  entries: readonly LaserficheEntry[],
  name: string,
): LaserficheEntry | undefined {
  return entries.find((entry) =>
    entry.entryType.toLowerCase() === "folder" && entry.name === name
  );
}

function parseEntry(value: unknown, operation: string): LaserficheEntry {
  const raw = value as EntryResponse;
  if (
    !raw || typeof raw !== "object" || !Number.isInteger(raw.id) ||
    (raw.id as number) < 1 || typeof raw.name !== "string" || !raw.name ||
    typeof raw.entryType !== "string" || !raw.entryType
  ) {
    throw invalidResponse(operation, "entry");
  }
  return {
    id: raw.id as number,
    name: raw.name,
    entryType: raw.entryType,
    ...optionalNumber("parentId", raw.parentId),
    ...optionalString("fullPath", raw.fullPath),
    ...optionalString("folderPath", raw.folderPath),
    ...optionalBoolean("isContainer", raw.isContainer),
    ...optionalBoolean("isLeaf", raw.isLeaf),
  };
}

function optionalNumber(
  name: "parentId",
  value: unknown,
): Partial<LaserficheEntry> {
  if (value === undefined || value === null) return {};
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw invalidResponse("ParseEntry", name);
  }
  return { [name]: value as number };
}

function optionalString(
  name: "fullPath" | "folderPath",
  value: unknown,
): Partial<LaserficheEntry> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") throw invalidResponse("ParseEntry", name);
  return { [name]: value };
}

function optionalBoolean(
  name: "isContainer" | "isLeaf",
  value: unknown,
): Partial<LaserficheEntry> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "boolean") throw invalidResponse("ParseEntry", name);
  return { [name]: value };
}

function validateToken(token: LaserficheAccessToken): LaserficheAccessToken {
  if (!token.accessToken?.trim()) {
    throw new LaserficheRestError("GetAccessToken", "invalid-token-response");
  }
  if (token.expiresAt && Number.isNaN(token.expiresAt.getTime())) {
    throw new LaserficheRestError("GetAccessToken", "invalid-token-response");
  }
  return token;
}

async function responseJson(
  response: Response,
  operation: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse(operation, "json");
  }
}

function invalidResponse(operation: string, kind: string): LaserficheRestError {
  return new LaserficheRestError(operation, `invalid-${kind}-response`);
}
