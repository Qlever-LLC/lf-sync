import type { JsonObject } from "./types.ts";

export async function readJsonl(path: string): Promise<JsonObject[]> {
  const text = await Deno.readTextFile(path);
  return text.split("\n").filter(Boolean).map((line, index) => {
    const value: unknown = JSON.parse(line);
    if (!isObject(value)) {
      throw new Error(`${path}:${index + 1} must be a JSON object`);
    }
    return value;
  });
}

export async function writeImmutableJsonl(
  directory: string,
  prefix: string,
  records: readonly JsonObject[],
): Promise<string> {
  await Deno.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(
    ".",
    "",
  );
  const path =
    `${directory}/${prefix}-${timestamp}-${crypto.randomUUID()}.jsonl`;
  await Deno.writeTextFile(path, `${records.map(canonicalJson).join("\n")}\n`, {
    createNew: true,
  });
  return path;
}

/** Stores staged source bytes by content digest so retries never duplicate them. */
export async function writeImmutableBytes(
  directory: string,
  digest: string,
  bytes: Uint8Array,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("Staged object digest must be a SHA-256 hex string");
  }
  const objectDirectory = `${directory}/objects`;
  const path = `${objectDirectory}/${digest}`;
  await Deno.mkdir(objectDirectory, { recursive: true });
  try {
    await Deno.writeFile(path, bytes, { createNew: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    const existing = await Deno.readFile(path);
    if (!equalBytes(existing, bytes)) {
      throw new Error(`Staged object ${digest} exists with different content`);
    }
  }
  return path;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}
