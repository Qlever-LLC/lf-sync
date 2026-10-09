import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.16";
import { CwsAdapter, CwsError } from "./cws.ts";
import type { Config } from "./config.ts";

const config: Config = {
  serviceName: "lf-sync",
  port: 8080,
  trellisConnect: false,
  trellisUrl: "http://localhost:3000",
  databaseUrl: "postgres://unused",
  writeMode: "enabled",
  backfillPageSize: 100,
  migrationObjectDirectory: "/tmp",
  outboxIntervalMs: 1_000,
  maxAttempts: 5,
  cwsApi: "https://cws.example/",
  cwsRepo: "Repository",
  cwsUser: "user",
  cwsPassword: "password",
  cwsTimeoutMs: 20_000,
  cwsConcurrency: 1,
  cwsSmokeOnStartup: false,
};

Deno.test("CWS mutations are blocked unless writes are enabled", async () => {
  const adapter = new CwsAdapter({ ...config, writeMode: "disabled" }, () => {
    throw new Error("must not make a request");
  });
  await assertRejects(
    () => adapter.createFolder("/trellis"),
    Error,
    "LF_SYNC_WRITE_MODE=disabled",
  );
});

Deno.test("CWS failures do not retain vendor response bodies", async () => {
  const adapter = new CwsAdapter(config, (input) => {
    const url = new URL(input.toString());
    return Promise.resolve(
      url.pathname.endsWith("ConnectionToLaserfiche")
        ? Response.json({ token_type: "Bearer", access_token: "test" })
        : new Response("vendor secret and stack trace", { status: 500 }),
    );
  });
  const error = await assertRejects(
    () => adapter.retrieveEntry("/"),
    CwsError,
    "RetrieveEntry failed (500)",
  );
  assertEquals("responseBody" in error, false);
  assertEquals(error.message.includes("vendor secret"), false);
});

for (
  const [operation, invoke] of [
    [
      "createFolder",
      (adapter: CwsAdapter, guard: () => Promise<void>) =>
        adapter.createFolder("/trellis", guard),
    ],
    [
      "createDocument",
      (adapter: CwsAdapter, guard: () => Promise<void>) =>
        adapter.createDocument({
          directoryPath: "/trellis",
          name: "document.pdf",
          contentType: "application/pdf",
          metadata: {},
        }, guard),
    ],
    [
      "uploadBuffer",
      (adapter: CwsAdapter, guard: () => Promise<void>) =>
        adapter.uploadBuffer(42, "pdf", new Uint8Array([1]), guard),
    ],
  ] as const
) {
  Deno.test(`${operation} rechecks its guard before an automatic 401 retry`, async () => {
    let mutationRequests = 0;
    let guardChecks = 0;
    const adapter = new CwsAdapter(config, (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("ConnectionToLaserfiche")) {
        return Promise.resolve(
          Response.json({ token_type: "Bearer", access_token: "test" }),
        );
      }
      mutationRequests += 1;
      return Promise.resolve(new Response(null, { status: 401 }));
    });
    const guard = () => {
      guardChecks += 1;
      if (guardChecks === 2) return Promise.reject(new Error("revoked"));
      return Promise.resolve();
    };

    await assertRejects(() => invoke(adapter, guard), Error, "revoked");
    assertEquals(guardChecks, 2);
    assertEquals(mutationRequests, 1);
  });
}

Deno.test("ensureDirectory creates missing folders and retains their entry IDs", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  const entries = new Map<
    number,
    {
      EntryId: number;
      Name: string;
      Type: string;
      Path: string;
      ParentId?: number;
    }
  >([
    [1, {
      EntryId: 1,
      Name: "ROOT FOLDER",
      Type: "Folder",
      Path: "\\ROOT FOLDER",
    }],
  ]);
  let nextId = 10;
  let guardChecks = 0;
  const adapter = new CwsAdapter(config, async (input, init) => {
    const request = init as globalThis.RequestInit | undefined;
    const url = new URL(input.toString());
    requests.push({ method: request?.method ?? "GET", path: url.pathname });
    if (url.pathname.endsWith("ConnectionToLaserfiche")) {
      return Response.json({ token_type: "Bearer", access_token: "test" });
    }
    if (/\/RetrieveEntry\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split("/").at(-1));
      const found = entries.get(id);
      return found ? Response.json(found) : new Response(null, { status: 404 });
    }
    if (/\/folders\/\d+\/contents$/.test(url.pathname)) {
      const parentId = Number(url.pathname.split("/").at(-2));
      return Response.json(
        [...entries.values()].filter((entry) => entry.ParentId === parentId),
      );
    }
    if (url.pathname.endsWith("CreateFolder")) {
      const body = JSON.parse(String(request?.body)) as {
        LaserficheFolderPath: string;
      };
      const name = body.LaserficheFolderPath.split("\\").at(-1)!;
      const parentPath = body.LaserficheFolderPath.split("\\").slice(0, -1)
        .join("\\");
      const parent = [...entries.values()].find((entry) =>
        entry.Path === parentPath
      ) ?? entries.get(1)!;
      const created = {
        EntryId: nextId++,
        Name: name,
        Type: "Folder",
        Path: body.LaserficheFolderPath,
        ParentId: parent.EntryId,
      };
      entries.set(created.EntryId, created);
      return Response.json({ LaserficheEntryID: created.EntryId });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  const directory = await adapter.ensureDirectory(
    "/trellis/trading-partners/Acme/Shared To Smithfield/Certificate",
    () => {
      guardChecks += 1;
      return Promise.resolve();
    },
  );
  assertEquals(directory.entries.map((entry) => entry.entryId), [
    10,
    11,
    12,
    13,
    14,
  ]);
  assertEquals(
    requests.filter((request) => request.path.endsWith("CreateFolder")).length,
    5,
  );
  assertEquals(
    requests.filter((request) => request.path.includes("/folders/")).length,
    5,
  );
  assertEquals(guardChecks, 10);
});

Deno.test("createDocument uses the CWS default volume and submits every available metadata field", async () => {
  let parameters: Record<string, unknown> | undefined;
  const adapter = new CwsAdapter(config, async (input, init) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("ConnectionToLaserfiche")) {
      return Response.json({ token_type: "Bearer", access_token: "test" });
    }
    if (/\/RetrieveEntry\/42$/.test(url.pathname)) {
      return Response.json({
        EntryId: 42,
        Name: "certificate.pdf",
        Type: "Document",
        Path: "\\trellis\\certificate.pdf",
      });
    }
    if (url.pathname.endsWith("CreateDocument")) {
      const request = init as globalThis.RequestInit;
      const body = request.body as FormData;
      parameters = JSON.parse(String(body.get("Parameters"))) as Record<
        string,
        unknown
      >;
      return Response.json({
        EntryId: 42,
        Name: "certificate.pdf",
        Type: "Document",
        Path: "\\trellis\\certificate.pdf",
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  await adapter.createDocument({
    directoryPath:
      "/trellis/trading-partners/Acme/Shared To Smithfield/Certificate",
    name: "certificate.pdf",
    contentType: "application/pdf",
    metadata: {
      Entity: "Acme",
      "Document Type": "Certificate",
      "Expiration Date": "2027-09-17",
      "Original Filename": "certificate.pdf",
    },
  });

  assertEquals(parameters?.LaserficheVolumeName, "Default");
  assertEquals("LaserficheTemplateName" in (parameters ?? {}), false);
  assertEquals(parameters?.LaserficheFieldList, [
    { Name: "Entity", Value: "Acme" },
    { Name: "Document Type", Value: "Certificate" },
    { Name: "Expiration Date", Value: "2027-09-17" },
    { Name: "Original Filename", Value: "certificate.pdf" },
  ]);
});
