import { assertEquals } from "jsr:@std/assert@1.0.16";
import { reconcileDirectory } from "./directory_reconciliation.ts";

Deno.test("reconcileDirectory persists every canonical path segment", async () => {
  const saved: Array<{ canonicalPath: string; parentDirectoryId?: string | null }> = [];
  const result = await reconcileDirectory({
    ensureDirectory: async () => ({ canonicalPath: "/trellis/Acme", entries: [
      { entryId: 10, name: "trellis", type: "Folder", path: "\\trellis" },
      { entryId: 11, name: "Acme", type: "Folder", path: "\\trellis\\Acme" },
    ] }),
  }, {
    upsertVerified: async (input) => {
      saved.push(input);
      return { id: String(saved.length) };
    },
  }, "Repository", "/trellis/Acme");

  assertEquals(saved.map((entry) => entry.canonicalPath), ["/trellis", "/trellis/Acme"]);
  assertEquals(saved[1]?.parentDirectoryId, "1");
  assertEquals(result, { directoryId: "2", cwsEntryId: "11" });
});
