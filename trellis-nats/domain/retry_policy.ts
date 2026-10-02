export type RetryDecision = {
  retryable: boolean;
  classification: "transient" | "permanent" | "ambiguous";
  retryAt?: Date;
  reason: string;
};

const MAX_DELAY_MS = 60 * 60 * 1000;

export function classifySubmitFailure(
  error: unknown,
  attemptNumber: number,
  now = new Date(),
): RetryDecision {
  const message = errorMessage(error);
  if (isPermanent(message)) {
    return { retryable: false, classification: "permanent", reason: message };
  }
  if (isTransient(message)) {
    return {
      retryable: true,
      classification: "transient",
      retryAt: new Date(now.getTime() + retryDelayMs(attemptNumber)),
      reason: message,
    };
  }
  return { retryable: false, classification: "ambiguous", reason: message };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "CWS submission failed";
}

function isTransient(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("operation was aborted") ||
    text.includes("trellis could not complete the request") ||
    text.includes("trellis could not reach the requested capability") ||
    text.includes("nats request failed") ||
    text.includes("connection reset") ||
    text.includes("connection closed") ||
    text.includes("econnreset") ||
    /\b(408|429|5\d\d)\b/.test(text);
}

function isPermanent(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("access denied") ||
    text.includes("permission") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("invalid peer certificate") ||
    text.includes("certificate expired") ||
    text.includes("not permitted while lf_sync_write_mode is disabled") ||
    text.includes("unsafe") ||
    text.includes("validation") ||
    text.includes("hash mismatch") ||
    text.includes("requires review");
}

function retryDelayMs(attemptNumber: number): number {
  const exponent = Math.max(0, Math.min(attemptNumber - 1, 6));
  const base = Math.min(30_000 * 2 ** exponent, MAX_DELAY_MS);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return base + jitter;
}
