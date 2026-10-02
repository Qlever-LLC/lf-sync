# Retry And Backpressure

LF Sync retries transient Laserfiche submission failures inside the always-running service. Retryable failures keep the delivery in `failed` with `next_attempt_at`; the retry loop claims due rows, resets them to `active`, resolves the triggering open failure, and submits the normal `submitLaserfiche` job.

Phase 1 covers transient Trellis/NATS timeouts, `Documents.Files.ReadChunk` timeouts, CWS timeouts, HTTP 408/429/5xx-style errors, and socket resets. Permanent validation, permission, authentication, unsafe-path, hash mismatch, and write-mode failures remain non-retryable.

Failure reporting is available through `scripts/reportDeliveryFailures.ts`. It groups rows as `retry-pending`, `retry-ready`, `retry-exhausted`, `non-retryable`, and `active-stale`, and includes target Laserfiche path, source document/version, retry counters, next attempt time, failure reason, and the queue snapshot captured at failure time.

Phase 2 should harden throughput rather than reduce intake unnecessarily:

- Add explicit LF Sync submit concurrency limits so FoodLogiQ-to-Trellis intake can keep a healthy backlog while CWS and byte-transfer work remain stable.
- Track timeout rate, completed deliveries per minute, retryable failures, non-retryable failures, active delivery age, and queue depth.
- Add adaptive backpressure: lower submit concurrency when transient timeout rate rises, then restore it after the queue stabilizes.
- Replace the chunked `Documents.Files.ReadChunk` fallback with the intended Trellis transfer receive path when service job handlers expose the receive helper reliably.
- Add remote CWS reconciliation for ambiguous post-create/upload timeouts where local entry mapping evidence is absent.
- Promote the failure report into the admin exception report UI with filters for retry-pending, retry-exhausted, non-retryable, and active-stale rows.
