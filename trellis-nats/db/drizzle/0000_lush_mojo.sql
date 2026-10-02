CREATE TYPE "public"."attempt_outcome" AS ENUM('started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_action" AS ENUM('create', 'update');--> statement-breakpoint
CREATE TYPE "public"."failure_class" AS ENUM('validation', 'not-found', 'timeout', 'transient', 'code-bug', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."failure_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."migration_status" AS ENUM('pending', 'running', 'completed', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_document_status" AS ENUM('received', 'ready', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('pending', 'active', 'review-required', 'approval-revoked', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sync_request_id" bigint NOT NULL,
	"source_document_id" bigint NOT NULL,
	"source_attachment_id" bigint NOT NULL,
	"directory_id" bigint,
	"idempotency_key" text NOT NULL,
	"source_sync_id" text,
	"payload_hash" text NOT NULL,
	"content_sha256" text,
	"bytes" bigint,
	"content_type" text,
	"upload_extension" text,
	"action" "delivery_action" NOT NULL,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"repository" text NOT NULL,
	"target_path" text NOT NULL,
	"target_name" text NOT NULL,
	"cws_entry_id" bigint,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delivery_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delivery_id" bigint NOT NULL,
	"stage" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "attempt_outcome" DEFAULT 'started' NOT NULL,
	"retryable" boolean,
	"duration_ms" integer,
	"sanitized_error" jsonb,
	"request_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "duplicate_candidates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository" text NOT NULL,
	"directory_id" bigint NOT NULL,
	"content_sha256" text NOT NULL,
	"canonical_entry_id" bigint,
	"duplicate_entry_id" bigint,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "failure_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sync_request_id" bigint,
	"delivery_id" bigint,
	"source_document_id" bigint,
	"stage" text NOT NULL,
	"failure_class" "failure_class" NOT NULL,
	"status" "failure_status" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"retryable" boolean NOT NULL,
	"status_code" integer,
	"attempt_number" integer,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laserfiche_directories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "laserfiche_directories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository" text NOT NULL,
	"canonical_path" text NOT NULL,
	"parent_directory_id" bigint,
	"cws_entry_id" bigint,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_mappings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delivery_id" bigint NOT NULL,
	"repository" text NOT NULL,
	"entry_id" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"source_sync_id" text,
	"content_sha256" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "migration_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_key" text NOT NULL,
	"source" text NOT NULL,
	"status" "migration_status" DEFAULT 'pending' NOT NULL,
	"manifest_digest" text,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "migration_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"migration_batch_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"source_version" text,
	"status" "migration_status" DEFAULT 'pending' NOT NULL,
	"classification" text,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"report_type" text NOT NULL,
	"requested_by" text,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer,
	"object_key" text,
	"sha256" text,
	"expires_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_attachments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_document_id" bigint NOT NULL,
	"source_system" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" text NOT NULL,
	"vdoc_key" text NOT NULL,
	"byte_reference" text NOT NULL,
	"content_type" text NOT NULL,
	"file_name" text,
	"attachment_id" text,
	"object_key" text,
	"original_filename" text,
	"declared_content_type" text,
	"detected_content_type" text,
	"declared_format" text,
	"detected_format" text,
	"upload_extension" text,
	"size_bytes" bigint,
	"checksum" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_system" text NOT NULL,
	"source_id" text NOT NULL,
	"source_version" text NOT NULL,
	"readiness_hash" text NOT NULL,
	"document_type" text,
	"supplier_id" text,
	"supplier_name" text,
	"status" "source_document_status" DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_document_id" bigint NOT NULL,
	"request_key" text NOT NULL,
	"operation_id" text,
	"requested_by" text,
	"reason" text NOT NULL,
	"status" "workflow_status" DEFAULT 'pending' NOT NULL,
	"requested_vdoc_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_sync_request_id_sync_requests_id_fk" FOREIGN KEY ("sync_request_id") REFERENCES "public"."sync_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_source_attachment_id_source_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."source_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_directory_id_laserfiche_directories_id_fk" FOREIGN KEY ("directory_id") REFERENCES "public"."laserfiche_directories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_directory_id_laserfiche_directories_id_fk" FOREIGN KEY ("directory_id") REFERENCES "public"."laserfiche_directories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_records" ADD CONSTRAINT "failure_records_sync_request_id_sync_requests_id_fk" FOREIGN KEY ("sync_request_id") REFERENCES "public"."sync_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_records" ADD CONSTRAINT "failure_records_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_records" ADD CONSTRAINT "failure_records_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_mappings" ADD CONSTRAINT "entry_mappings_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_items" ADD CONSTRAINT "migration_items_migration_batch_id_migration_batches_id_fk" FOREIGN KEY ("migration_batch_id") REFERENCES "public"."migration_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_attachments" ADD CONSTRAINT "source_attachments_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_requests" ADD CONSTRAINT "sync_requests_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_idempotency_uq" ON "deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_status_created_idx" ON "deliveries" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_stage_uq" ON "delivery_attempts" USING btree ("delivery_id","stage","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_candidates_hash_scope_uq" ON "duplicate_candidates" USING btree ("repository","directory_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "laserfiche_directories_path_uq" ON "laserfiche_directories" USING btree ("repository","canonical_path");--> statement-breakpoint
CREATE UNIQUE INDEX "laserfiche_directories_entry_uq" ON "laserfiche_directories" USING btree ("repository","cws_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_mappings_delivery_uq" ON "entry_mappings" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_mappings_idempotency_uq" ON "entry_mappings" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_mappings_entry_uq" ON "entry_mappings" USING btree ("repository","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_batches_key_uq" ON "migration_batches" USING btree ("batch_key");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_items_key_uq" ON "migration_items" USING btree ("migration_batch_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_attachments_version_uq" ON "source_attachments" USING btree ("source_system","source_id","source_version","vdoc_key");--> statement-breakpoint
CREATE INDEX "source_attachments_document_idx" ON "source_attachments" USING btree ("source_document_id","vdoc_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_version_uq" ON "source_documents" USING btree ("source_system","source_id","source_version");--> statement-breakpoint
CREATE INDEX "source_documents_readiness_hash_idx" ON "source_documents" USING btree ("readiness_hash");--> statement-breakpoint
CREATE INDEX "source_documents_approved_idx" ON "source_documents" USING btree ("approved_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_requests_request_key_uq" ON "sync_requests" USING btree ("request_key");