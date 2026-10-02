import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { loadConfig } from "../config.ts";
import { CwsAdapter } from "../cws.ts";
import contract from "../contracts/lf_sync.ts";
import { connectPostgres, createRepositories } from "../db/mod.ts";
import type { FoodLogiQAttachmentTransferClient } from "../domain/attachment_validation.ts";
import { submitDelivery } from "../runtime/delivery_workflow.ts";

const apply = Deno.args.includes("--apply");
const deliveryIds = values("--delivery-id");
const documentTypeIds = values("--document-type-id");
const failureReason = value("--failure-reason");
const reviewCode = value("--review-code");
const noOpenFailure = Deno.args.includes("--no-open-failure");
const preflightRead = Deno.args.includes("--preflight-read");
const batchSize = intArg("--batch-size", 25, 1, 100);
const maxBatches = intArg("--max-batches", 100, 1, 10000);
const sleepMs = intArg("--sleep-ms", 1000, 0, 60000);

const config = loadConfig();
if (apply && config.writeMode !== "enabled") {
  throw new Error("LF_SYNC_WRITE_MODE must be enabled to drain deliveries");
}
if (apply && !config.sessionKeySeed) {
  throw new Error("TRELLIS_SESSION_KEY_SEED is required");
}

const db = connectPostgres(config.databaseUrl, { max: 1 });
try {
  const repositories = createRepositories(db);
  const cws = new CwsAdapter(config);
  const attachmentClient = apply
    ? await TrellisService.connect({
      trellisUrl: config.trellisUrl,
      contract,
      name: `${config.serviceName}-drain-submit-${Date.now()}`,
      sessionKeySeed: config.sessionKeySeed!,
    }).orThrow()
    : undefined;
  let totalSelected = 0;
  let totalSubmitted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  try {
    for (let batch = 1; batch <= maxBatches; batch++) {
      const rows = await selectRows(batchSize);
      totalSelected += rows.length;
      console.log(
        JSON.stringify({
          event: "batch-selected",
          apply,
          batch,
          selected: rows.length,
        }),
      );
      if (rows.length === 0) break;

      let submitted = 0;
      let failed = 0;
      let skipped = 0;
      for (const row of rows) {
        const deliveryId = row.id;
        if (!apply) {
          console.log(JSON.stringify({ event: "would-submit", deliveryId }));
          continue;
        }
        const details = await repositories.deliveries.getDelivery(deliveryId);
        if (!details) throw new Error(`Delivery ${deliveryId} is unavailable`);
        const attachment = await repositories.sources.getAttachmentById(
          details.delivery.sourceAttachmentId,
        );
        if (!attachment) {
          throw new Error(
            `Source attachment for delivery ${deliveryId} is unavailable`,
          );
        }
        if (preflightRead) {
          const read = await preflightAttachmentRead(
            attachmentClient!,
            attachment.byteReference,
          );
          if (!read.ok) {
            skipped += 1;
            console.log(JSON.stringify({
              event: "skipped-unreadable",
              batch,
              deliveryId,
              attachmentId: attachment.byteReference,
              error: read.error,
            }));
            continue;
          }
        }
        try {
          if (failureReason || reviewCode) {
            await db.execute(
              `UPDATE deliveries
             SET status = 'active', retry_count = 0, next_attempt_at = NULL, result = '{}'::jsonb,
                 finished_at = NULL, updated_at = now()
             WHERE id = $1`,
              [deliveryId],
            );
          }
          const result = await submitDelivery({
            writeMode: config.writeMode,
            cws,
            attachmentClient: attachmentClient!,
            repositories,
            delivery: details.delivery,
            attachment,
          });
          if (!result.reviewRequired && result.entryId !== undefined) {
            await repositories.deliveries.finalize(deliveryId, "completed", {
              laserficheEntryId: result.entryId,
              ...(result.cwsName ? { laserficheName: result.cwsName } : {}),
              ...(result.cwsPath ? { laserfichePath: result.cwsPath } : {}),
            });
            await repositories.syncRequests.finalize(
              details.delivery.syncRequestId,
              "completed",
              {
                completedDeliveries: 1,
              },
            ).catch((error) => {
              console.warn(JSON.stringify({
                event: "sync-request-finalize-skipped",
                deliveryId,
                syncRequestId: details.delivery.syncRequestId,
                error: error instanceof Error ? error.message : String(error),
              }));
            });
            await db.execute(
              `UPDATE failure_records SET status = 'resolved', resolved_at = now(), updated_at = now()
             WHERE delivery_id = $1 AND status = 'open'`,
              [deliveryId],
            );
          }
          submitted += 1;
          console.log(
            JSON.stringify({
              event: "submitted",
              batch,
              deliveryId,
              entryId: result.entryId,
              reviewRequired: result.reviewRequired,
            }),
          );
        } catch (error) {
          failed += 1;
          console.error(
            JSON.stringify({
              event: "failed",
              batch,
              deliveryId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      totalSubmitted += submitted;
      totalFailed += failed;
      totalSkipped += skipped;
      console.log(
        JSON.stringify({
          event: "batch-complete",
          apply,
          batch,
          selected: rows.length,
          submitted,
          failed,
          skipped,
        }),
      );
      if (sleepMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }
  } finally {
    await attachmentClient?.stop();
  }

  console.log(
    JSON.stringify({
      event: "complete",
      apply,
      totalSelected,
      totalSubmitted,
      totalFailed,
      totalSkipped,
    }),
  );
} finally {
  await db.close();
  setTimeout(() => Deno.exit(0), 100);
}

async function selectRows(limit: number): Promise<Array<{ id: string }>> {
  const deliveryFilter = deliveryIds.length > 0
    ? `AND d.id IN (${
      deliveryIds.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger)
        .join(",")
    })`
    : "";
  const typeFilter = documentTypeIds.length > 0
    ? `AND sd.document_type IN (${
      documentTypeIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(",")
    })`
    : "";
  const failureFilter = failureReason
    ? `AND d.status = 'failed'
       AND (
         SELECT fr.reason FROM failure_records AS fr
         WHERE fr.delivery_id = d.id AND fr.status = 'open'
         ORDER BY fr.occurred_at DESC, fr.id DESC
         LIMIT 1
         ) = '${failureReason.replaceAll("'", "''")}'`
    : reviewCode
    ? `AND d.status = 'review-required'
       AND d.result #>> '{reviewCode}' = '${reviewCode.replaceAll("'", "''")}'`
    : `AND d.status = 'active'`;
  const openFailureFilter = noOpenFailure
    ? `AND NOT EXISTS (
         SELECT 1 FROM failure_records AS fr
         WHERE fr.delivery_id = d.id AND fr.status = 'open'
       )`
    : "";
  return await db.query<{ id: string }>(
    `
    SELECT d.id::text AS id
    FROM deliveries AS d
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    WHERE TRUE
      ${failureFilter}
      ${openFailureFilter}
      AND d.cws_entry_id IS NULL
      ${deliveryFilter}
      ${typeFilter}
    ORDER BY d.id
    LIMIT $1
  `,
    [limit],
  );
}

async function preflightAttachmentRead(
  client: FoodLogiQAttachmentTransferClient,
  attachmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof client.documentsFilesReadChunk !== "function") {
    return { ok: false, error: "Documents.Files.ReadChunk is unavailable" };
  }
  try {
    await client.documentsFilesReadChunk({ attachmentId, offset: 0, length: 1 })
      .orThrow();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function values(name: string): string[] {
  const prefix = `${name}=`;
  const result: string[] = [];
  for (let index = 0; index < Deno.args.length; index += 1) {
    const arg = Deno.args[index];
    if (arg?.startsWith(prefix)) result.push(arg.slice(prefix.length).trim());
    const next = Deno.args[index + 1];
    if (arg === name && next) result.push(next.trim());
  }
  return result.filter(Boolean);
}

function value(name: string): string | undefined {
  const prefix = `${name}=`;
  for (let index = 0; index < Deno.args.length; index += 1) {
    const arg = Deno.args[index];
    if (arg?.startsWith(prefix)) return arg.slice(prefix.length).trim();
    const next = Deno.args[index + 1];
    if (arg === name && next) return next.trim();
  }
  return undefined;
}

function intArg(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const inline = Deno.args.find((arg) => arg.startsWith(`${name}=`));
  const positionalIndex = Deno.args.indexOf(name);
  const raw = inline?.slice(name.length + 1) ??
    (positionalIndex === -1 ? undefined : Deno.args[positionalIndex + 1]);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
