import { assertEquals } from "jsr:@std/assert@1.0.16";
import { submitToCws } from "./cws_submission.ts";

Deno.test("submitToCws uploads a newly created entry and reuses a persisted mapping", async () => {
  const calls: string[] = [];
  const cws = {
    createDocument: async () => {
      calls.push("create");
      return { entryId: 42, name: "a.pdf", type: "Document", path: "\\a.pdf" };
    },
    uploadBuffer: async () => { calls.push("upload"); },
  };
  const input = {
    directoryPath: "/trellis", name: "a.pdf", contentType: "application/pdf",
    metadata: { Entity: "Acme" }, extension: "pdf", bytes: new Uint8Array([1]),
  };
  assertEquals(await submitToCws(cws, input), {
    entryId: 42,
    created: true,
    entry: { entryId: 42, name: "a.pdf", type: "Document", path: "\\a.pdf" },
  });
  assertEquals(calls, ["create", "upload"]);
  calls.length = 0;
  assertEquals(await submitToCws(cws, { ...input, existingEntryId: 42 }), { entryId: 42, created: false });
  assertEquals(calls, []);
});
