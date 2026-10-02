import { assertEquals } from "jsr:@std/assert@1.0.17";
import { candidateFromJob, parseLegacyJob } from "./parser.ts";

Deno.test("parses and deterministically classifies a mapped legacy job", () => {
  const job = parseLegacyJob("/failures/a", {
    sourceRef: "/legacy/sources/42",
    attachments: [{
      key: "invoice",
      href: "/legacy/bytes/1",
      mimeType: "application/pdf",
    }],
  });
  if (!job) throw new Error("Expected job");
  const candidate = candidateFromJob(
    job,
    new Map([["/legacy/sources/42", {
      legacySourceRef: "/legacy/sources/42",
      sourceSystem: "legacy-oada",
      sourceId: "42",
      sourceVersion: "v1",
      sourcePath: "/legacy/sources/42",
    }]]),
  );
  assertEquals(candidate.classification, "safe-to-submit");
  assertEquals(candidate.attachments[0]?.vdocKey, "invoice");
});

Deno.test("requires an explicit source mapping", () => {
  const job = parseLegacyJob("/failures/a", {
    sourceRef: "/unmapped",
    attachments: [],
  });
  if (!job) throw new Error("Expected job");
  assertEquals(
    candidateFromJob(job, new Map()).classification,
    "missing-source",
  );
});
