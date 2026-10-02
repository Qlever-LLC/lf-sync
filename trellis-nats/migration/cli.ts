import { connectPostgres } from "../db/postgres.ts";
import { readJsonl, writeImmutableJsonl } from "./jsonl.ts";
import { readerFromEnv } from "./oada.ts";
import { loadSourceMappings } from "./parser.ts";
import { importMappings, inventoryFailures, stageFailures } from "./runner.ts";
import type { CandidateRecord, JsonObject } from "./types.ts";

type Mode = "inventory" | "import-mappings" | "stage-failures";

export async function main(
  args = Deno.args,
  env = Deno.env.toObject(),
): Promise<void> {
  const options = parseArgs(args);
  const mode = requiredMode(options.mode);
  const objectDirectory = options["object-directory"] ??
    env.LF_SYNC_MIGRATION_OBJECT_DIRECTORY ??
    "/var/lib/lf-sync/migration-objects";
  const execute = options.execute === "true";
  if (mode === "inventory") {
    const mappings = loadSourceMappings(
      await readJsonl(required(options, "source-mappings")),
    );
    const result = await inventoryFailures({
      reader: readerFromEnv(env),
      failureIndexRoot: required(options, "failure-index-root"),
      mappings,
      objectDirectory,
    });
    console.log(`Inventory manifest: ${result.manifestPath}`);
    console.log(`Inventory checkpoint: ${result.checkpointPath}`);
    return;
  }
  const candidates = (await readJsonl(required(options, "candidates"))).map(
    asCandidate,
  );
  if (!execute) {
    const path = await writeImmutableJsonl(
      objectDirectory,
      `${mode}-dry-run`,
      candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        classification: candidate.classification,
        mutation: "not-authorized",
        required: ["--execute", "LEGACY_OADA_MIGRATION_APPROVED=1"],
      })),
    );
    console.log(`Dry run only. Immutable audit record: ${path}`);
    return;
  }
  if (env.LEGACY_OADA_MIGRATION_APPROVED !== "1") {
    throw new Error("--execute requires LEGACY_OADA_MIGRATION_APPROVED=1");
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database mutations");
  }
  const database = connectPostgres(databaseUrl);
  try {
    if (mode === "import-mappings") {
      console.log(
        `Import checkpoint: ${await importMappings(
          database,
          candidates,
          objectDirectory,
        )}`,
      );
    } else {
      console.log(
        `Staging checkpoint: ${await stageFailures({
          database,
          reader: readerFromEnv(env),
          candidates,
          batchKey: options["batch-key"] ??
            `legacy-oada-stage-${new Date().toISOString().slice(0, 10)}`,
          objectDirectory,
        })}`,
      );
    }
  } finally {
    await database.close();
  }
}

function parseArgs(args: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const [name, inline] = argument.slice(2).split("=", 2);
    if (!name) throw new Error("Empty option name");
    const value = inline ??
      (args[index + 1]?.startsWith("--") ? undefined : args[++index]);
    options[name] = value ?? "true";
  }
  return options;
}
function required(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value || value === "true") throw new Error(`--${name} is required`);
  return value;
}
function requiredMode(value: string | undefined): Mode {
  if (
    value === "inventory" || value === "import-mappings" ||
    value === "stage-failures"
  ) return value;
  throw new Error(
    "--mode must be inventory, import-mappings, or stage-failures",
  );
}
function asCandidate(value: JsonObject): CandidateRecord {
  if (
    value.kind !== "legacy-oada-candidate" ||
    typeof value.candidateKey !== "string"
  ) throw new Error("Candidate JSONL must contain inventory manifest records");
  return value as CandidateRecord;
}

if (import.meta.main) await main();
