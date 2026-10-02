import { CwsAdapter } from "../cws.ts";
import { loadConfig } from "../config.ts";

const APPROVED_TARGET = "/FSQA/trellis/scratch";
const target = Deno.env.get("LF_SYNC_CWS_SMOKE_TARGET");
if (target !== APPROVED_TARGET) {
  throw new Error(`LF_SYNC_CWS_SMOKE_TARGET must be exactly ${APPROVED_TARGET}`);
}

const config = loadConfig();
if (config.writeMode !== "enabled") {
  throw new Error("LF_SYNC_WRITE_MODE must be enabled for the CWS write smoke test");
}

const name = `lf-sync-smoke-${new Date().toISOString().replaceAll(/[^0-9]/g, "")}.txt`;
const bytes = new TextEncoder().encode(`LF Sync CWS smoke test\n${name}\n`);
const cws = new CwsAdapter(config);
const entry = await cws.createDocument({
  directoryPath: target,
  name,
  contentType: "text/plain",
  metadata: {
    Entity: "LF Sync smoke test",
    "Document Type": "LF Sync smoke test",
    "Original Filename": name,
    "Document Date": new Date().toISOString().slice(0, 10),
  },
});
console.log(JSON.stringify({ stage: "created", entryId: entry.entryId, path: entry.path }));
await cws.uploadBuffer(entry.entryId, "txt", bytes);
console.log(JSON.stringify({ stage: "uploaded", entryId: entry.entryId, byteLength: bytes.length }));
let received: Uint8Array | undefined;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    received = await cws.documentBytes(entry.entryId);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
}
if (!received) throw new Error("CWS content readback did not return bytes");
if (received.length !== bytes.length || !received.every((byte, index) => byte === bytes[index])) {
  throw new Error("CWS readback bytes differ from the uploaded smoke document");
}
console.log(JSON.stringify({
  message: "CWS write smoke test completed",
  repository: config.cwsRepo,
  target,
  entryId: entry.entryId,
  name,
  byteLength: bytes.length,
}));
