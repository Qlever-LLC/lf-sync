import type { JsonObject, LegacyOadaReader } from "./types.ts";

export interface HttpsOadaReaderOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

/** A deliberately small read-only OADA client; it has no CWS dependency. */
export class HttpsOadaReader implements LegacyOadaReader {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: HttpsOadaReaderOptions) {
    this.baseUrl = new URL(options.baseUrl);
    if (this.baseUrl.protocol !== "https:") {
      throw new Error("LEGACY_OADA_BASE_URL must use HTTPS");
    }
    if (!options.token.trim()) throw new Error("LEGACY_OADA_TOKEN is required");
    this.fetcher = options.fetch ?? fetch;
  }

  async getJson(path: string): Promise<JsonObject> {
    const response = await this.request(path, "application/json");
    const value: unknown = await response.json();
    if (!isObject(value)) throw new Error(`Expected an object at ${path}`);
    return value;
  }

  async getBytes(path: string): Promise<Uint8Array> {
    const response = await this.request(path, "*/*");
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(path: string, accept: string): Promise<Response> {
    const url = new URL(normalizePath(path), this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new Error("OADA path escapes base URL");
    }
    const response = await this.fetcher(url, {
      headers: { accept, authorization: `Bearer ${this.options.token}` },
    });
    if (!response.ok) {
      throw new Error(`OADA GET ${url.pathname} failed: ${response.status}`);
    }
    return response;
  }
}

export function readerFromEnv(env = Deno.env.toObject()): LegacyOadaReader {
  const baseUrl = env.LEGACY_OADA_BASE_URL;
  const token = env.LEGACY_OADA_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("LEGACY_OADA_BASE_URL and LEGACY_OADA_TOKEN are required");
  }
  return new HttpsOadaReader({ baseUrl, token });
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`OADA paths must be absolute: ${path}`);
  }
  return path;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
