import { getSqlOutboxMigrations } from "@qlever-llc/trellis/service";
import { foundationMigration } from "./001_foundation.ts";
import { workflowStatusesMigration } from "./002_workflow_statuses.ts";
import { readinessHashIndexMigration } from "./003_readiness_hash_index.ts";
import { cwsDeliveryStateMigration } from "./004_cws_delivery_state.ts";
import { sourceSupplierColumnsMigration } from "./005_source_supplier_columns.ts";
import { sourceAttachmentEvidenceColumnsMigration } from "./006_source_attachment_evidence_columns.ts";
import { deliveryRetryStateMigration } from "./007_delivery_retry_state.ts";
import { sourceSupplierNameBackfillMigration } from "./008_backfill_source_supplier_names.ts";
import { entryMappingEvidenceColumnsMigration } from "./009_entry_mapping_evidence_columns.ts";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum?: string;
}

const trellisOutboxMigrations = getSqlOutboxMigrations({
  dialect: "postgres",
  tables: { outbox: "trellis_outbox", inbox: "trellis_inbox" },
}).map((migration) => ({
  version: foundationMigration.version + migration.version,
  name: migration.id,
  sql: `${migration.up.join(";\n")};`,
  checksum: migration.checksum,
}));

const workflowStatusMigration = {
  ...workflowStatusesMigration,
  version: Math.max(
    foundationMigration.version,
    ...trellisOutboxMigrations.map((migration) => migration.version),
  ) + 1,
};

const readinessHashMigration = {
  ...readinessHashIndexMigration,
  version: workflowStatusMigration.version + 1,
};

const cwsDeliveryState = {
  ...cwsDeliveryStateMigration,
  version: readinessHashMigration.version + 1,
};

const sourceSupplierColumns = {
  ...sourceSupplierColumnsMigration,
  version: cwsDeliveryState.version + 1,
};

const sourceAttachmentEvidenceColumns = {
  ...sourceAttachmentEvidenceColumnsMigration,
  version: sourceSupplierColumns.version + 1,
};

const deliveryRetryState = {
  ...deliveryRetryStateMigration,
  version: sourceAttachmentEvidenceColumns.version + 1,
};

const sourceSupplierNameBackfill = {
  ...sourceSupplierNameBackfillMigration,
  version: deliveryRetryState.version + 1,
};

const entryMappingEvidenceColumns = {
  ...entryMappingEvidenceColumnsMigration,
  version: sourceSupplierNameBackfill.version + 1,
};

export const migrations: readonly Migration[] = [
  foundationMigration,
  ...trellisOutboxMigrations,
  workflowStatusMigration,
  readinessHashMigration,
  cwsDeliveryState,
  sourceSupplierColumns,
  sourceAttachmentEvidenceColumns,
  deliveryRetryState,
  sourceSupplierNameBackfill,
  entryMappingEvidenceColumns,
];
