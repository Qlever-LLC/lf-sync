import {
  validateAttachmentFormat,
  type AttachmentFormatValidation,
} from "./file_format.ts";

type Result<T> = { orThrow(): Promise<T> };
type Transfer = { bytes(): Result<Uint8Array> };
const CHUNK_BYTES = 32768;

export interface FoodLogiQAttachmentTransferClient {
  documentsFilesDownload(
    input: { attachmentId: string },
  ): Result<{ transfer: unknown }>;
  transfer?(grant: unknown): Transfer;
  documentsFilesReadChunk?(input: {
    attachmentId: string;
    offset: number;
    length: number;
  }): Result<{
    dataBase64: string;
    byteLength: number;
    totalByteLength: number;
    done: boolean;
  }>;
}

export type AttachmentValidationInput = {
  attachmentId: string;
  filename: string;
  declaredContentType?: string | null;
  expectedSha256?: string | null;
  expectedByteLength?: string | null;
};

export type AttachmentValidation = {
  bytes: Uint8Array;
  byteLength: string;
  sha256: string;
  format: AttachmentFormatValidation;
  reviewRequired: boolean;
  reason?: string;
  reviewCode?: string;
};

/** Receives version-scoped attachment bytes and derives the only upload facts CWS may use. */
export async function receiveAndValidateAttachment(
  client: FoodLogiQAttachmentTransferClient,
  input: AttachmentValidationInput,
): Promise<AttachmentValidation> {
  const bytes = await receiveAttachmentBytes(client, input.attachmentId);
  const sha256 = await sha256Hex(bytes);
  const byteLength = String(bytes.byteLength);
  const format = validateAttachmentFormat({
    filename: input.filename,
    declaredContentType: input.declaredContentType,
    bytes,
  });
  const empty = bytes.byteLength === 0;
  const reason = empty ? "Attachment is empty" : format.reason ??
    (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256
      ? "Downloaded bytes do not match the source SHA-256"
      : input.expectedByteLength && input.expectedByteLength !== byteLength
      ? "Downloaded byte length does not match source metadata"
      : undefined);
  const reviewCode = empty ? "empty-attachment" : format.reviewCode;
  return {
    bytes,
    byteLength,
    sha256,
    format,
    reviewRequired: reason !== undefined,
    ...(reason ? { reason } : {}),
    ...(reviewCode ? { reviewCode } : {}),
  };
}

async function receiveAttachmentBytes(
  client: FoodLogiQAttachmentTransferClient,
  attachmentId: string,
): Promise<Uint8Array> {
  if (typeof client.transfer === "function") {
    const grant = await client.documentsFilesDownload({ attachmentId }).orThrow();
    return await client.transfer(grant.transfer).bytes().orThrow();
  }
  if (typeof client.documentsFilesReadChunk !== "function") {
    throw new Error("FoodLogiQ attachment transfer is unavailable");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let offset = 0; ; offset += CHUNK_BYTES) {
    const chunk = await client.documentsFilesReadChunk({
      attachmentId,
      offset,
      length: CHUNK_BYTES,
    }).orThrow();
    const bytes = decodeBase64(chunk.dataBase64);
    if (bytes.byteLength !== chunk.byteLength) {
      throw new Error("FoodLogiQ chunk byte length mismatch");
    }
    chunks.push(bytes);
    total += bytes.byteLength;
    if (chunk.done) {
      if (total !== chunk.totalByteLength) {
        throw new Error("FoodLogiQ chunked download length mismatch");
      }
      return concat(chunks, total);
    }
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
