/**
 * @license
 * Copyright 2026 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type CwsFailureClass =
  | "validation"
  | "not-found"
  | "timeout"
  | "transient"
  | "code-bug"
  | "unknown";

export interface CwsErrorDetails {
  endpoint?: string;
  failureClass: CwsFailureClass;
  method?: string;
  reason?: string;
  request?: Record<string, unknown>;
  responseBody?: string;
  retryable: boolean;
  statusCode?: number;
  statusMessage?: string;
  url?: string;
}

interface GotLikeError extends Error {
  code?: string;
  cws?: CwsErrorDetails;
  options?: {
    method?: string;
    prefixUrl?: string | URL;
    url?: string | URL;
  };
  request?: {
    options?: {
      method?: string;
      prefixUrl?: string | URL;
      url?: string | URL;
    };
    requestUrl?: string | URL;
  };
  response?: {
    body?: unknown;
    rawBody?: Uint8Array;
    statusCode?: number;
    statusMessage?: string;
    url?: string;
  };
}

const MAX_REASON_LENGTH = 1000;
const MAX_BODY_LENGTH = 2000;
const MESSAGE_FIELDS = [
  "ExceptionMessage",
  "Message",
  "message",
  "error_description",
  "error",
  "detail",
  "title",
  "Reason",
  "reason",
];
const DETAIL_FIELDS = [
  "ModelState",
  "modelState",
  "Errors",
  "errors",
  "Response",
  "response",
];
const REDACTED_FIELDS = new Set([
  "Authorization",
  "authorization",
  "Password",
  "password",
  "StackTrace",
  "stackTrace",
  "access_token",
  "token",
]);

export async function withCwsErrorContext<T>(
  promise: Promise<T>,
  context: Pick<CwsErrorDetails, "endpoint" | "request">,
): Promise<T> {
  try {
    return await promise;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw enrichCwsError(error, context);
    }

    throw error;
  }
}

export function enrichCwsError(
  error: Error,
  context: Pick<CwsErrorDetails, "endpoint" | "request"> = {},
): Error {
  const details = getCwsErrorDetails(error);
  if (!details) return error;

  const gotError = error as GotLikeError;
  gotError.cws = {
    ...details,
    ...context,
    request: {
      ...details.request,
      ...context.request,
    },
  };

  gotError.message = formatCwsErrorMessage(gotError.cws, error.message);
  return gotError;
}

export function getCwsErrorDetails(
  error: unknown,
): CwsErrorDetails | undefined {
  if (!(error instanceof Error)) return undefined;

  const gotError = error as GotLikeError;
  if (gotError.cws) return gotError.cws;

  const { response } = gotError;
  const url = getUrl(gotError);
  if (!response) {
    const failureClass = classifyFailure(undefined, gotError.code);
    if (failureClass === "unknown") return;

    return {
      endpoint: getEndpoint(url),
      failureClass,
      method: gotError.options?.method ?? gotError.request?.options?.method,
      reason: error.message,
      retryable: isRetryable(failureClass),
      url,
    };
  }

  const { statusCode } = response;
  const parsedBody = parseResponseBody(response.body, response.rawBody);
  const reason = extractReason(parsedBody);
  const failureClass = classifyFailure(statusCode, gotError.code);
  const retryable = isRetryable(failureClass);

  return {
    endpoint: getEndpoint(url),
    failureClass,
    method: gotError.options?.method ?? gotError.request?.options?.method,
    reason,
    responseBody: stringifyBody(parsedBody),
    retryable,
    statusCode,
    statusMessage: response.statusMessage,
    url,
  };
}

function formatCwsErrorMessage(details: CwsErrorDetails, fallback: string) {
  const endpoint = details.endpoint ?? "CWS request";
  const status = details.statusCode
    ? `${details.statusCode}${details.statusMessage ? ` ${details.statusMessage}` : ""}`
    : undefined;
  const reason = details.reason ? `: ${details.reason}` : "";

  if (status) return `${endpoint} failed with ${status}${reason}`;

  return `${endpoint} failed${reason || `: ${fallback}`}`;
}

function parseResponseBody(body: unknown, rawBody?: Uint8Array): unknown {
  if (body !== undefined && body !== "") return body;
  if (!rawBody || rawBody.length === 0) return;

  const text = Buffer.from(rawBody).toString("utf8").trim();
  if (!text) return;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractReason(body: unknown): string | undefined {
  const messages = collectMessages(body);
  const usefulMessage = messages.find(
    (message) => message !== "An error has occurred.",
  );
  return truncate((usefulMessage ?? messages[0])?.trim(), MAX_REASON_LENGTH);
}

function collectMessages(value: unknown): string[] {
  if (typeof value === "string") {
    const message = compact(value);
    return message ? [message] : [];
  }

  if (Array.isArray(value))
    return value.flatMap((item) => collectMessages(item));

  if (!isRecord(value)) return [];

  const messages = [];
  for (const field of MESSAGE_FIELDS) {
    if (field in value) messages.push(...collectMessages(value[field]));
  }

  for (const field of DETAIL_FIELDS) {
    if (field in value) messages.push(...collectMessages(value[field]));
  }

  return [...new Set(messages)];
}

function classifyFailure(
  statusCode: number | undefined,
  code: string | undefined,
): CwsFailureClass {
  const normalizedCode = code?.toUpperCase();
  if (
    normalizedCode?.includes("TIMEOUT") === true ||
    normalizedCode?.includes("TIMEDOUT") === true
  ) {
    return "timeout";
  }

  if (normalizedCode === "EAI_AGAIN" || normalizedCode === "ECONNRESET") {
    return "transient";
  }

  if (statusCode === 400 || statusCode === 422) return "validation";
  if (statusCode === 404) return "not-found";
  if (statusCode === 408 || statusCode === 504) return "timeout";
  if (statusCode && statusCode >= 500) return "transient";

  return "unknown";
}

function isRetryable(failureClass: CwsFailureClass) {
  return failureClass === "timeout" || failureClass === "transient";
}

function stringifyBody(body: unknown): string | undefined {
  if (body === undefined) return;

  const sanitized = sanitize(body);
  const text =
    typeof sanitized === "string"
      ? compact(sanitized)
      : JSON.stringify(sanitized);

  return truncate(text, MAX_BODY_LENGTH);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      REDACTED_FIELDS.has(key) ? "[redacted]" : sanitize(item),
    ]),
  );
}

function getUrl(error: GotLikeError) {
  return String(
    error.response?.url ??
      error.request?.requestUrl ??
      error.options?.url ??
      error.request?.options?.url ??
      "",
  );
}

function getEndpoint(url: string | undefined) {
  if (!url) return;

  try {
    return new URL(url).pathname.replace(/^.*\/api\//, "api/");
  } catch {
    return url.replace(/^.*\/api\//, "api/");
  }
}

function compact(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) return;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
