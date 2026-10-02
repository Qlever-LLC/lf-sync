export class LaserficheRestError extends Error {
  readonly sanitized = true;

  constructor(
    readonly operation: string,
    readonly code: string,
    readonly statusCode?: number,
    readonly operationId?: string,
    readonly traceId?: string,
  ) {
    super(
      `${operation} failed${
        statusCode === undefined ? "" : ` (${statusCode})`
      }`,
    );
    this.name = "LaserficheRestError";
  }
}

type ProblemDetails = {
  type?: unknown;
  error?: unknown;
  operationId?: unknown;
  traceId?: unknown;
};

export async function errorFromResponse(
  operation: string,
  response: Response,
): Promise<LaserficheRestError> {
  let problem: ProblemDetails = {};
  try {
    problem = await response.clone().json() as ProblemDetails;
  } catch {
    // Error bodies are optional and intentionally never retained verbatim.
  }
  return new LaserficheRestError(
    operation,
    safeIdentifier(problem.type) ?? safeIdentifier(problem.error) ??
      `http-${response.status}`,
    response.status,
    safeIdentifier(problem.operationId),
    safeIdentifier(problem.traceId),
  );
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return undefined;
  return /^[A-Za-z0-9._:/-]+$/.test(normalized) ? normalized : undefined;
}
