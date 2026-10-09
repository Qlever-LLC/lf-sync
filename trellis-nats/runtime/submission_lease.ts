export const SUBMISSION_LEASE_MS = 60_000;
export const SUBMISSION_RENEW_INTERVAL_MS = 20_000;

export class SubmissionFencedError extends Error {
  constructor() {
    super("Submission claim is no longer valid");
    this.name = "SubmissionFencedError";
  }
}

export function submissionLeaseUntil(now = Date.now()): Date {
  return new Date(now + SUBMISSION_LEASE_MS);
}

export function startSubmissionLease(input: {
  deliveryId: string;
  claimOwner: string;
  renew(
    deliveryId: string,
    claimOwner: string,
    leaseUntil: Date,
  ): Promise<boolean>;
  leaseMs?: number;
  intervalMs?: number;
}): {
  guard(): Promise<void>;
  stop(): Promise<void>;
} {
  const leaseMs = input.leaseMs ?? SUBMISSION_LEASE_MS;
  let fenced = false;
  let stopped = false;
  let renewal: Promise<void> | undefined;

  const guard = async () => {
    if (fenced || stopped) throw new SubmissionFencedError();
    if (!renewal) {
      renewal = (async () => {
        if (
          !await input.renew(
            input.deliveryId,
            input.claimOwner,
            new Date(Date.now() + leaseMs),
          )
        ) {
          fenced = true;
          throw new SubmissionFencedError();
        }
      })().finally(() => {
        renewal = undefined;
      });
    }
    await renewal;
  };

  const heartbeat = setInterval(() => {
    void guard().catch(() => {
      fenced = true;
    });
  }, input.intervalMs ?? SUBMISSION_RENEW_INTERVAL_MS);

  return {
    guard,
    stop: async () => {
      stopped = true;
      clearInterval(heartbeat);
      await renewal?.catch(() => undefined);
    },
  };
}
