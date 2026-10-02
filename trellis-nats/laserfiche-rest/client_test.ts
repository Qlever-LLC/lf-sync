import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.16";
import { LaserficheRestClient } from "./client.ts";
import { LaserficheRestError } from "./errors.ts";
import type { LaserficheRestClientOptions } from "./types.ts";

const entry = (id: number, name: string, parentId = 1) => ({
  id,
  name,
  parentId,
  fullPath: `\\${name}`,
  entryType: "Folder",
  isContainer: true,
  isLeaf: true,
});

function options(
  fetchFn: typeof fetch,
  overrides: Partial<LaserficheRestClientOptions> = {},
): LaserficheRestClientOptions {
  return {
    apiBaseUrl: "https://laserfiche.example/LFRepositoryAPI",
    repositoryId: "Repository",
    getAccessToken: () =>
      Promise.resolve({ accessToken: "token", tokenType: "Bearer" }),
    fetch: fetchFn,
    ...overrides,
  };
}

Deno.test("getEntry caches a valid token and sends it only to the API server", async () => {
  const tokenRequests: boolean[] = [];
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const client = new LaserficheRestClient(options(
    async (input, init) => {
      const request = init as globalThis.RequestInit | undefined;
      requests.push({
        url: input.toString(),
        authorization: new Headers(request?.headers).get("authorization"),
      });
      return Response.json(entry(42, "Certificate"));
    },
    {
      getAccessToken: ({ forceRefresh }) => {
        tokenRequests.push(forceRefresh);
        return Promise.resolve({
          accessToken: "secret-token",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
        });
      },
      now: () => new Date("2029-01-01T00:00:00Z"),
    },
  ));

  await client.getEntry(42);
  await client.getEntry(42);

  assertEquals(tokenRequests, [false]);
  assertEquals(requests, [
    {
      url:
        "https://laserfiche.example/LFRepositoryAPI/v2/Repositories/Repository/Entries/42",
      authorization: "Bearer secret-token",
    },
    {
      url:
        "https://laserfiche.example/LFRepositoryAPI/v2/Repositories/Repository/Entries/42",
      authorization: "Bearer secret-token",
    },
  ]);
});

Deno.test("concurrent requests share one token acquisition", async () => {
  let resolveToken: ((value: { accessToken: string }) => void) | undefined;
  const pendingToken = new Promise<{ accessToken: string }>((resolve) => {
    resolveToken = resolve;
  });
  let tokenRequests = 0;
  const client = new LaserficheRestClient(options(
    () => Promise.resolve(Response.json(entry(42, "Certificate"))),
    {
      getAccessToken: () => {
        tokenRequests++;
        return pendingToken;
      },
    },
  ));

  const requests = [client.getEntry(42), client.getEntry(43)];
  await Promise.resolve();
  resolveToken?.({ accessToken: "token" });
  await Promise.all(requests);

  assertEquals(tokenRequests, 1);
});

Deno.test("a 401 forces one token refresh and retries the request", async () => {
  const tokenRequests: boolean[] = [];
  const authorization: Array<string | null> = [];
  let requests = 0;
  const client = new LaserficheRestClient(options(
    async (_input, init) => {
      const request = init as globalThis.RequestInit | undefined;
      authorization.push(new Headers(request?.headers).get("authorization"));
      requests++;
      if (requests === 1) return new Response(null, { status: 401 });
      return Response.json(entry(42, "Certificate"));
    },
    {
      getAccessToken: ({ forceRefresh }) => {
        tokenRequests.push(forceRefresh);
        return Promise.resolve({
          accessToken: forceRefresh ? "refreshed" : "initial",
        });
      },
    },
  ));

  await client.getEntry(42);

  assertEquals(tokenRequests, [false, true]);
  assertEquals(authorization, ["Bearer initial", "Bearer refreshed"]);
});

Deno.test("a mutating retry rechecks the mutation guard", async () => {
  let guardCalls = 0;
  let requests = 0;
  const client = new LaserficheRestClient(options(
    () => {
      requests++;
      if (requests === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(Response.json(entry(10, "FSQA"), { status: 201 }));
    },
    {
      mutationGuard: () => {
        guardCalls++;
      },
    },
  ));

  await client.createFolder(1, "FSQA");

  assertEquals(guardCalls, 2);
});

Deno.test("listFolderChildren follows same-API pagination", async () => {
  const requested: string[] = [];
  const client = new LaserficheRestClient(options(async (input) => {
    const url = new URL(input.toString());
    requested.push(url.toString());
    if (url.searchParams.get("page") === "2") {
      return Response.json({ value: [entry(11, "Second")] });
    }
    return Response.json({
      value: [entry(10, "First")],
      "@odata.nextLink":
        "https://laserfiche.example/LFRepositoryAPI/v2/Repositories/Repository/Entries/1/Folder/Children?page=2",
    });
  }));

  const children = await client.listFolderChildren(1);

  assertEquals(children.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "First" },
    { id: 11, name: "Second" },
  ]);
  assertEquals(requested.length, 2);
});

Deno.test("listFolderChildren rejects an off-origin next link", async () => {
  let requests = 0;
  const client = new LaserficheRestClient(options(() => {
    requests++;
    return Promise.resolve(Response.json({
      value: [entry(10, "First")],
      "@odata.nextLink": "https://attacker.example/collect",
    }));
  }));

  const error = await assertRejects(
    () => client.listFolderChildren(1),
    LaserficheRestError,
  );

  assertEquals(error.code, "invalid-unsafe-next-link-response");
  assertEquals(requests, 1);
});

Deno.test("createFolder defaults to denying mutations", async () => {
  const client = new LaserficheRestClient(options(() => {
    throw new Error("must not request");
  }));

  const error = await assertRejects(
    () => client.createFolder(1, "FSQA"),
    LaserficheRestError,
  );

  assertEquals(error.code, "mutation-not-authorized");
});

Deno.test("ensureDirectory creates missing folders under their resolved parents", async () => {
  const folders = new Map<number, ReturnType<typeof entry>[]>([[1, []]]);
  const creates: Array<{ parentId: number; name: string }> = [];
  let nextId = 10;
  const client = new LaserficheRestClient(options(
    async (input, init) => {
      const request = init as globalThis.RequestInit | undefined;
      const url = new URL(input.toString());
      const parentId = Number(url.pathname.split("/").at(-3));
      if ((request?.method ?? "GET") === "GET") {
        return Response.json({ value: folders.get(parentId) ?? [] });
      }
      const body = JSON.parse(String(request?.body)) as { name: string };
      creates.push({ parentId, name: body.name });
      const created = entry(nextId++, body.name, parentId);
      folders.set(parentId, [...(folders.get(parentId) ?? []), created]);
      folders.set(created.id, []);
      return Response.json(created, { status: 201 });
    },
    { mutationGuard: () => {} },
  ));

  const directory = await client.ensureDirectory("/FSQA/Acme/Certificates");

  assertEquals(creates, [
    { parentId: 1, name: "FSQA" },
    { parentId: 10, name: "Acme" },
    { parentId: 11, name: "Certificates" },
  ]);
  assertEquals(directory.entries.map((item) => item.id), [10, 11, 12]);
});

Deno.test("ensureDirectory recovers an already-created folder after a conflict", async () => {
  let listings = 0;
  const client = new LaserficheRestClient(options(
    async (_input, init) => {
      const request = init as globalThis.RequestInit | undefined;
      if ((request?.method ?? "GET") === "POST") {
        return Response.json({ type: "entry-exists" }, { status: 409 });
      }
      listings++;
      return Response.json({
        value: listings === 1 ? [] : [entry(10, "FSQA")],
      });
    },
    { mutationGuard: () => {} },
  ));

  const directory = await client.ensureDirectory("/FSQA");

  assertEquals(directory.entries.map((item) => item.id), [10]);
  assertEquals(listings, 2);
});

Deno.test("HTTP errors expose bounded identifiers without retaining response details", async () => {
  const client = new LaserficheRestClient(
    options(() =>
      Promise.resolve(Response.json({
        type: "invalid-request",
        title: "password=do-not-retain",
        operationId: "operation-123",
        traceId: "trace-456",
      }, { status: 400 }))
    ),
  );

  const error = await assertRejects(
    () => client.getEntry(42),
    LaserficheRestError,
  );

  assertEquals(error.code, "invalid-request");
  assertEquals(error.operationId, "operation-123");
  assertEquals(error.traceId, "trace-456");
  assert(!error.message.includes("do-not-retain"));
  assertEquals(error.sanitized, true);
});

Deno.test("token-provider and malformed JSON failures are sanitized", async () => {
  const tokenFailure = new LaserficheRestClient(options(
    () => Promise.resolve(Response.json(entry(42, "Certificate"))),
    {
      getAccessToken: () => {
        throw new Error("password=do-not-retain");
      },
    },
  ));
  const tokenError = await assertRejects(
    () => tokenFailure.getEntry(42),
    LaserficheRestError,
  );
  assertEquals(tokenError.code, "token-provider-failed");
  assert(!tokenError.message.includes("do-not-retain"));

  const malformedResponse = new LaserficheRestClient(
    options(() => Promise.resolve(new Response("not-json", { status: 200 }))),
  );
  const responseError = await assertRejects(
    () => malformedResponse.getEntry(42),
    LaserficheRestError,
  );
  assertEquals(responseError.code, "invalid-json-response");
});
