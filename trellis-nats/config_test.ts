import { assertEquals } from "jsr:@std/assert";
import { loadConfig } from "./config.ts";

Deno.test("explicit false environment values remain false", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://lf-sync:password@database/lf_sync",
    LF_SYNC_TRELLIS_CONNECT: "false",
    LF_SYNC_CWS_SMOKE_ON_STARTUP: "false",
  });

  assertEquals(config.trellisConnect, false);
  assertEquals(config.cwsSmokeOnStartup, false);
  assertEquals(config.writeMode, "disabled");
});
