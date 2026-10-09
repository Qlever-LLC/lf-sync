import type { Config } from "./config.ts";

export type CwsHealth = {
  ok: boolean;
  checkedAt: string;
  apiRoot: string;
  repository: string;
  root?: CwsEntry;
  error?: string;
};

export type CwsEntry = {
  entryId: number;
  name: string;
  type: string;
  path: string;
};

export type CwsDirectory = {
  canonicalPath: string;
  entries: readonly CwsEntry[];
};

export type CwsMetadata = {
  templateName?: string;
  fields: readonly { name: string; values: readonly string[] }[];
};

export type CwsSearchHit = { entryId: number };

export type CwsDocumentInput = {
  directoryPath: string;
  name: string;
  contentType: string;
  metadata: Record<string, string | string[]>;
  template?: string;
  volume?: string;
};

export class CwsError extends Error {
  constructor(
    readonly operation: string,
    readonly statusCode?: number,
  ) {
    super(
      `${operation} failed${
        statusCode === undefined ? "" : ` (${statusCode})`
      }`,
    );
  }
}

type Fetch = typeof fetch;

type CwsTokenResponse = {
  access_token: string;
  token_type: string;
};

type CwsEntryResponse = {
  EntryId?: number;
  LaserficheEntryID?: number;
  Name: string;
  Type: string;
  Path: string;
};

export class CwsAdapter {
  private token: string | undefined;

  constructor(
    private readonly config: Config,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async retrieveEntry(path: string): Promise<CwsEntry> {
    const url = this.url("api/RetrieveEntry");
    url.searchParams.set("Path", cwsPath(path));
    return entry(await this.request("RetrieveEntry", url));
  }

  async retrieveEntryById(entryId: number): Promise<CwsEntry> {
    return entry(
      await this.request(
        "RetrieveEntry",
        this.url(`api/RetrieveEntry/${entryId}`),
      ),
    );
  }

  async browse(path: string): Promise<CwsEntry[]> {
    const url = this.url("api/browse");
    url.searchParams.set("path", cwsPath(path));
    return entries(await this.request("Browse", url));
  }

  async retrieveFolder(entryId: number): Promise<CwsEntry> {
    const url = this.url("api/RetrieveFolder");
    url.searchParams.set("LaserficheEntryId", String(entryId));
    return entry(await this.request("RetrieveFolder", url));
  }

  async folderContents(entryId: number): Promise<CwsEntry[]> {
    return entries(
      await this.request(
        "FolderContents",
        this.url(`api/folders/${entryId}/contents`),
      ),
    );
  }

  async retrieveDocument(entryId: number): Promise<CwsEntry> {
    const url = this.url("api/RetrieveDocument");
    url.searchParams.set("LaserficheEntryId", String(entryId));
    return entry(await this.request("RetrieveDocument", url));
  }

  async documentBytes(entryId: number): Promise<Uint8Array> {
    const url = this.url("api/RetrieveDocumentContent");
    url.searchParams.set("LaserficheEntryId", String(entryId));
    const response = await this.request("RetrieveDocumentContent", url);
    return new Uint8Array(await response.arrayBuffer());
  }

  async metadata(entryId: number): Promise<CwsMetadata> {
    const url = this.url("api/GetMetadata");
    url.searchParams.set("LaserficheEntryId", String(entryId));
    const raw = await (await this.request("GetMetadata", url)).json() as {
      TemplateName?: string;
      LaserficheFieldList?: Array<
        { Name?: string; Value?: string; Values?: string[] }
      >;
    };
    return {
      ...(raw.TemplateName ? { templateName: raw.TemplateName } : {}),
      fields: (raw.LaserficheFieldList ?? []).flatMap((field) =>
        field.Name
          ? [{
            name: field.Name,
            values: field.Values ??
              (field.Value === undefined ? [] : [field.Value]),
          }]
          : []
      ),
    };
  }

  async searchEntries(phrase: string): Promise<CwsSearchHit[]> {
    const raw = await (await this.request(
      "SearchEntries",
      this.url("api/SearchEntries"),
      {
        method: "POST",
        json: { LaserficheSearchPhrase: phrase },
      },
    )).json() as Array<{ EntryId?: number }>;
    return raw.flatMap((hit) =>
      typeof hit.EntryId === "number" && Number.isInteger(hit.EntryId)
        ? [{ entryId: hit.EntryId }]
        : []
    );
  }

  async ensureDirectory(
    canonicalPath: string,
    guard?: () => Promise<void>,
  ): Promise<CwsDirectory> {
    const segments = canonicalPath.split("/").filter(Boolean);
    if (segments.length === 0) throw new Error("Directory path is required");
    const entries: CwsEntry[] = [];
    let parent = await this.retrieveEntryById(1);
    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      const existing = (await this.folderContents(parent.entryId)).find((
        entry,
      ) => entry.type.toLowerCase() === "folder" && entry.name === segment);
      if (existing) {
        entries.push(existing);
        parent = existing;
        continue;
      }
      const created = await this.createFolder(currentPath, guard);
      await guard?.();
      entries.push(created);
      parent = created;
    }
    return { canonicalPath, entries };
  }

  async createFolder(
    path: string,
    guard?: () => Promise<void>,
  ): Promise<CwsEntry> {
    this.requireWrite("CreateFolder");
    await guard?.();
    const created = await entryId(
      await this.request("CreateFolder", this.url("api/CreateFolder"), {
        method: "POST",
        json: { LaserficheFolderPath: cwsPath(path) },
        retryGuard: guard,
      }),
    );
    return await this.retrieveEntryById(created);
  }

  async createDocument(
    input: CwsDocumentInput,
    guard?: () => Promise<void>,
  ): Promise<CwsEntry> {
    this.requireWrite("CreateDocument");
    await guard?.();
    const form = new FormData();
    form.set(
      "Parameters",
      JSON.stringify({
        LaserficheFolderPath: cwsPath(input.directoryPath),
        LaserficheDocumentName: input.name,
        LaserficheVolumeName: input.volume ?? "Default",
        LaserficheTemplateName: input.template,
        LaserficheFieldList: fields(input.metadata),
      }),
    );
    const created = await entryId(
      await this.request("CreateDocument", this.url("api/CreateDocument"), {
        method: "POST",
        body: form,
        retryGuard: guard,
      }),
    );
    return await this.retrieveEntryById(created);
  }

  async createGenericDocument(
    name: string,
    metadata?: Record<string, string | string[]>,
  ): Promise<CwsEntry> {
    this.requireWrite("CreateGenericDocument");
    const form = new FormData();
    form.set("DocumentName", name);
    if (metadata) form.set("Metadata", JSON.stringify(metadata));
    return entry(
      await this.request(
        "CreateGenericDocument",
        this.url("api/CreateGenericDocument"),
        {
          method: "POST",
          body: form,
        },
      ),
    );
  }

  async uploadBuffer(
    entryId: number,
    extension: string,
    bytes: Uint8Array,
    guard?: () => Promise<void>,
  ): Promise<void> {
    this.requireWrite("UploadDocument");
    await guard?.();
    const body = new Uint8Array(bytes.length);
    body.set(bytes);
    await this.request(
      "UploadDocument",
      this.url(`api/Document/${entryId}/${extension}`),
      { method: "PUT", body: body.buffer, retryGuard: guard },
    );
  }

  async setMetadata(
    entryId: number,
    metadata: Record<string, string | string[]>,
    template?: string,
  ): Promise<void> {
    this.requireWrite("SetMetadata");
    await this.request("SetMetadata", this.url("api/SetMetadata"), {
      method: "POST",
      json: {
        LaserficheEntryId: entryId,
        LaserficheTemplateName: template,
        LaserficheFieldList: fields(metadata),
      },
    });
  }

  async moveEntry(
    entryId: number,
    destinationParentPath: string,
  ): Promise<void> {
    this.requireWrite("MoveEntry");
    await this.request("MoveEntry", this.url("api/Entry/Move"), {
      method: "PUT",
      json: {
        LaserficheEntryID: entryId,
        DestinationParentPath: cwsPath(destinationParentPath),
      },
    });
  }

  async renameEntry(
    entryId: number,
    destinationParentPath: string,
    name: string,
  ): Promise<void> {
    this.requireWrite("RenameEntry");
    await this.request("RenameEntry", this.url("api/Entry/Move"), {
      method: "PUT",
      json: {
        LaserficheEntryID: entryId,
        DestinationParentPath: cwsPath(destinationParentPath),
        Name: name,
      },
    });
  }

  async indexEntry(entryId: number): Promise<void> {
    this.requireWrite("IndexEntry");
    await this.request("IndexEntry", this.url(`api/Entry/${entryId}/index`), {
      method: "PUT",
    });
  }

  async migrateEntry(entryId: number, volume: string): Promise<void> {
    this.requireWrite("MigrateEntry");
    await this.request("MigrateEntry", this.url("api/Entry/Migrate"), {
      method: "PUT",
      json: { LaserficheEntryID: entryId, DestinationVolumeName: volume },
    });
  }

  async deleteFolder(entryId: number): Promise<void> {
    this.requireWrite("DeleteFolder");
    await this.request("DeleteFolder", this.url("api/DeleteFolder"), {
      method: "DELETE",
      json: { LaserficheEntryId: entryId },
    });
  }

  async deleteDocument(entryId: number): Promise<void> {
    this.requireWrite("DeleteDocument");
    await this.request("DeleteDocument", this.url("api/DeleteDocument"), {
      method: "DELETE",
      json: { LaserficheEntryId: entryId },
    });
  }

  async initChunkedUpload(entryId: number): Promise<void> {
    this.requireWrite("InitUpload");
    await this.request("InitUpload", this.url("api/InitUpload"), {
      method: "POST",
      json: { LaserficheEntryID: entryId },
    });
  }

  async uploadChunk(
    entryId: number,
    offset: number,
    bytes: Uint8Array,
  ): Promise<void> {
    this.requireWrite("UploadChunk");
    const url = this.url("api/UploadChunk");
    url.searchParams.set("laserficheEntryID", String(entryId));
    url.searchParams.set("offset", String(offset));
    const body = new Uint8Array(bytes.length);
    body.set(bytes);
    await this.request("UploadChunk", url, {
      method: "POST",
      body: body.buffer,
    });
  }

  async completeChunkedUpload(entryId: number): Promise<void> {
    this.requireWrite("CompleteUpload");
    await this.request("CompleteUpload", this.url("api/CompleteUpload"), {
      method: "PUT",
      json: { LaserficheEntryID: entryId },
    });
  }

  private requireWrite(operation: string): void {
    if (this.config.writeMode === "enabled") return;
    throw new CwsError(
      `${operation} is not permitted while LF_SYNC_WRITE_MODE=${this.config.writeMode}`,
    );
  }

  private async request(
    operation: string,
    url: URL,
    options: {
      method?: string;
      json?: unknown;
      body?: BodyInit;
      retryGuard?: () => Promise<void>;
    } = {},
    retrying = false,
  ): Promise<Response> {
    const token = await this.getToken();
    const response = await this.fetchFn(url, {
      method: options.method,
      headers: {
        authorization: token,
        ...(options.json === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.json === undefined
        ? { body: options.body }
        : { body: JSON.stringify(options.json) }),
      signal: AbortSignal.timeout(this.config.cwsTimeoutMs),
    });
    if (response.status === 401 && !retrying) {
      this.token = undefined;
      await options.retryGuard?.();
      return await this.request(operation, url, options, true);
    }
    if (!response.ok) {
      throw new CwsError(operation, response.status);
    }
    return response;
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    if (
      !this.config.cwsApi || !this.config.cwsRepo || !this.config.cwsUser ||
      !this.config.cwsPassword
    ) {
      throw new CwsError("CWS configuration is incomplete");
    }
    const auth = btoa(JSON.stringify({
      repositoryName: this.config.cwsRepo,
      username: this.config.cwsUser,
      password: this.config.cwsPassword,
      serverName: this.config.cwsServer,
    }));
    const response = await this.fetchFn(
      this.url("api/ConnectionToLaserfiche"),
      {
        method: "POST",
        headers: {
          authorization: `basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "password" }),
        signal: AbortSignal.timeout(this.config.cwsTimeoutMs),
      },
    );
    if (!response.ok) throw new CwsError("CWS login", response.status);
    const body = await response.json() as CwsTokenResponse;
    this.token = `${body.token_type} ${body.access_token}`;
    return this.token;
  }

  private url(path: string): URL {
    if (!this.config.cwsApi) {
      throw new CwsError("CWS configuration is incomplete");
    }
    return new URL(path, this.config.cwsApi);
  }
}

export async function checkCws(config: Config): Promise<CwsHealth> {
  const checkedAt = new Date().toISOString();
  const apiRoot = config.cwsApi ?? "";
  const repository = config.cwsRepo ?? "";
  try {
    const root = await new CwsAdapter(config).retrieveEntry("/");
    return { ok: true, checkedAt, apiRoot, repository, root };
  } catch {
    return {
      ok: false,
      checkedAt,
      apiRoot,
      repository,
      error: "CWS request failed",
    };
  }
}

function entry(response: Response): Promise<CwsEntry> {
  return response.json().then((value) => {
    const raw = value as CwsEntryResponse;
    const entryId = raw.EntryId ?? raw.LaserficheEntryID;
    if (
      typeof entryId !== "number" || !Number.isInteger(entryId) ||
      entryId < 1 ||
      !raw.Name || !raw.Type || !raw.Path
    ) {
      throw new CwsError(
        `CWS returned an invalid entry response (keys: ${
          Object.keys(raw).sort().join(",")
        })`,
      );
    }
    return { entryId, name: raw.Name, type: raw.Type, path: raw.Path };
  });
}

async function entryId(response: Response): Promise<number> {
  const raw = await response.json() as CwsEntryResponse;
  const id = raw.EntryId ?? raw.LaserficheEntryID;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    throw new CwsError("CWS returned an invalid create-entry response");
  }
  return id;
}

function entries(response: Response): Promise<CwsEntry[]> {
  return response.json().then((value) => {
    if (!Array.isArray(value)) {
      throw new CwsError("CWS returned an invalid entry list");
    }
    return Promise.all(value.map((item) => entry(Response.json(item))));
  });
}

function cwsPath(path: string): string {
  if (path === "/") return "\\";
  return `\\${path.split("/").filter(Boolean).join("\\")}`;
}

function fields(metadata: Record<string, string | string[]>): unknown[] {
  return Object.entries(metadata).map(([Name, value]) =>
    Array.isArray(value) ? { Name, Values: value } : { Name, Value: value }
  );
}
