import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { loadConfig } from "../config.ts";
import { CwsAdapter } from "../cws.ts";
import contract from "../contracts/lf_sync.ts";
import { connectPostgres, createRepositories } from "../db/mod.ts";
import type { FoodLogiQAttachmentTransferClient } from "../domain/attachment_validation.ts";
import { submitDelivery } from "../runtime/delivery_workflow.ts";
import {
  startSubmissionLease,
  submissionLeaseUntil,
} from "../runtime/submission_lease.ts";

const apply = Deno.args.includes("--apply");
const limitArg = Deno.args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 10;
const documentTypeIds = Deno.args
  .filter((arg) => arg.startsWith("--document-type-id="))
  .map((arg) => arg.slice("--document-type-id=".length).trim())
  .filter(Boolean);

if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit must be an integer from 1 to 100");
}
if (documentTypeIds.length === 0) {
  throw new Error("At least one --document-type-id is required");
}

const config = loadConfig();
if (apply && config.writeMode !== "enabled") {
  throw new Error("LF_SYNC_WRITE_MODE must be enabled to submit deliveries");
}
if (apply && !config.sessionKeySeed) {
  throw new Error("TRELLIS_SESSION_KEY_SEED is required");
}

const db = connectPostgres(config.databaseUrl, { max: 1 });
try {
  const typeList = documentTypeIds.map((id) => `'${id.replaceAll("'", "''")}'`)
    .join(",");
  const rows = await db.query<{ id: string }>(
    `
    SELECT d.id::text AS id
    FROM deliveries AS d
    JOIN source_documents AS sd ON sd.id = d.source_document_id
    WHERE d.status = 'active'
      AND d.cws_entry_id IS NULL
      AND sd.document_type IN (${typeList})
    ORDER BY d.id
    LIMIT $1
  `,
    [limit],
  );

  const repositories = createRepositories(db);
  const cws = new CwsAdapter(config);
  let submitted = 0;
  let failed = 0;
  for (const row of rows) {
    const deliveryId = row.id;
    console.log(
      JSON.stringify({
        event: apply ? "submitting" : "would-submit",
        deliveryId,
      }),
    );
    if (!apply) continue;
    const details = await repositories.deliveries.getDelivery(deliveryId);
    if (!details) throw new Error(`Delivery ${deliveryId} is unavailable`);
    const claimOwner = `direct-submit:${crypto.randomUUID()}`;
    const claimed = await repositories.deliveries.claimForSubmission(
      deliveryId,
      claimOwner,
      submissionLeaseUntil(),
    );
    if (!claimed) continue;
    const lease = startSubmissionLease({
      deliveryId,
      claimOwner,
      renew: (id, owner, leaseUntil) =>
        repositories.deliveries.renewSubmissionClaim(id, owner, leaseUntil),
    });
    let attachmentClient:
      | (FoodLogiQAttachmentTransferClient & { stop(): Promise<void> })
      | undefined;
    try {
      const attachment = await repositories.sources.getAttachmentById(
        claimed.sourceAttachmentId,
      );
      if (!attachment) {
        throw new Error(
          `Source attachment for delivery ${deliveryId} is unavailable`,
        );
      }
      attachmentClient = await TrellisService.connect({
        trellisUrl: config.trellisUrl,
        contract,
        name: `${config.serviceName}-direct-submit-${deliveryId}-${Date.now()}`,
        sessionKeySeed: config.sessionKeySeed!,
      }).orThrow();
      const result = await submitDelivery({
        writeMode: config.writeMode,
        cws,
        attachmentClient,
        repositories,
        delivery: claimed,
        attachment,
        claimOwner,
        guard: lease.guard,
      });
      if (!result.reviewRequired && result.entryId !== undefined) {
        await repositories.deliveries.finalize(deliveryId, "completed", {
          laserficheEntryId: result.entryId,
          ...(result.cwsName ? { laserficheName: result.cwsName } : {}),
          ...(result.cwsPath ? { laserfichePath: result.cwsPath } : {}),
        }, claimOwner);
        await repositories.syncRequests.finalizeFromDeliveries(
          claimed.syncRequestId,
        );
      }
      submitted++;
      console.log(
        JSON.stringify({
          event: "submitted",
          deliveryId,
          entryId: result.entryId,
          reviewRequired: result.reviewRequired,
        }),
      );
    } catch (error) {
      failed++;
      console.error(
        JSON.stringify({
          event: "failed",
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      try {
        await attachmentClient?.stop();
      } finally {
        await lease.stop();
        await repositories.deliveries.releaseSubmissionClaim(
          deliveryId,
          claimOwner,
        );
      }
    }
  }
  console.log(
    JSON.stringify({
      event: "complete",
      apply,
      selected: rows.length,
      submitted,
      failed,
    }),
  );
} finally {
  await db.close();
  setTimeout(() => Deno.exit(0), 100);
}
