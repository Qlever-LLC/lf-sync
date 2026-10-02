import { CwsAdapter } from "../cws.ts";
import { loadConfig } from "../config.ts";

const APPROVED_TARGET = "/FSQA/trellis/scratch";
if (Deno.env.get("LF_SYNC_CWS_SCRATCH_TARGET") !== APPROVED_TARGET) {
  throw new Error(`LF_SYNC_CWS_SCRATCH_TARGET must be exactly ${APPROVED_TARGET}`);
}

const config = loadConfig();
if (config.writeMode !== "enabled") {
  throw new Error("LF_SYNC_WRITE_MODE must be enabled to create the approved CWS scratch directory");
}

const entry = await new CwsAdapter(config).createFolder(APPROVED_TARGET);
console.log(JSON.stringify({
  message: "CWS scratch directory created",
  target: APPROVED_TARGET,
  entryId: entry.entryId,
  path: entry.path,
}));
