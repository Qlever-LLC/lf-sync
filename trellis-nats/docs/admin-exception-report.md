# Deferred Qlever Admin Exception Report

## Status

This is an approved post-implementation and post-deployment enhancement. Do
not add its LF Sync public contract, capability grants, report generation, or
COI review app UI until the core LF Sync service is implemented, deployed in
no-write projection mode, and its source intake and dashboard reads are
validated.

## Purpose

The report will give Qlever administrators an auditable operational view of
delivery exceptions that need internal remediation. It is not a vendor-facing
surface and must not present unresolved evidence as a supplier failure.

The primary workflow is triage: locate open exceptions, understand their
source and safe remediation guidance, then export the active filtered set when
an external audit artifact is needed.

## Exceptions In Scope

First-class classifications include:

- `unknown-format`: attachment bytes do not match a supported detected format.
- `declared-format-mismatch`: declared filename extension or content type
  conflicts with detected attachment bytes.
- `filing-metadata-invalid`: required source filing metadata is absent, invalid,
  or contains an unsafe path segment.
- `laserfiche-repository-unconfigured`: delivery preparation cannot select its
  configured repository.

Additional terminal validation and CWS reconciliation exceptions may join this
same queue only after they have a durable, sanitized classification and
operator-safe remediation message.

## Data And Safety

Each exception row and detail view will contain only:

- Source document and version identifiers.
- Attachment/vdoc identifier and original filename.
- Supplier and document type when available.
- Classification, workflow stage, status, timestamps, and safe remediation
  guidance.
- Declared and detected content types/extensions when a format decision exists.
- Stable delivery and failure identifiers when created.

Never expose attachment bytes, raw FoodLogiQ payloads, CWS request or response
bodies, authorization headers, credentials, signed URLs, stack traces, or
database diagnostics through the report, CSV, Trellis events, or COI app.

## Deferred Contract And Authorization

When this work is activated, introduce separate local LF Sync capabilities:

- `exceptions.read`: list and view exception projections.
- `exceptions.export`: generate and download a CSV for the current filtered
  exception set.

Trellis qualifies these as `lf-sync::exceptions.read` and
`lf-sync::exceptions.export`. Grant both only to Qlever administrators. The
COI review app must use authenticated Trellis RPCs and capability acquisition;
it must not make direct Postgres, CWS, or FoodLogiQ calls.

The future public surface should provide cursor-paginated exception list and
detail RPCs, plus an asynchronous CSV report operation and receive-transfer
download. The report must be generated server-side from typed filters and kept
in the LF Sync report object store with its normal expiry policy.

## COI App Surface

Add an admin-only navigation entry that is absent without
`lf-sync::exceptions.read`. The page is a restrained, responsive operational
queue using the app's existing light workspace, dark navigation, and semantic
state vocabulary.

Its primary surface is a filterable, cursor-paginated table. Filters include
classification, status, supplier, document type, and occurrence time. A detail
route shows source provenance and the sanitized decision record. CSV export
applies the current filters and requires `lf-sync::exceptions.export`.

Required states are loading, empty, unavailable capability, report generation,
download-ready, and sanitized service failure. Meet WCAG 2.1 AA and do not rely
on color alone for a classification or state.

## Activation Prerequisites

1. LF Sync core source intake, preparation, byte validation, idempotent CWS
   submission, finalization, and lifecycle outbox are implemented.
2. LF Sync is deployed in no-write projection mode and source intake plus
   dashboard reads are validated.
3. The deployment authority reviews and applies the required LF Sync contract
   migration and Qlever-admin grants.
4. The report object-store binding and receive-transfer authorization are
   validated with sanitized test data.
5. The COI app UI design brief is reconfirmed if its surrounding navigation or
   visual system has changed since this document was written.
