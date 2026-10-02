# Self-Hosted Laserfiche REST API Plan

## Purpose

Prepare LF Sync to use the self-hosted Laserfiche Repository API V2 without
changing the active CWS delivery path. The REST client is an isolated library;
it is not selected by runtime configuration and is not reachable from Trellis
RPCs, jobs, or event handlers.

The installed API Server Swagger document will be authoritative once access is
available. Public Laserfiche documentation describes both Cloud and self-hosted
deployments, but some newer V2 operations are currently documented as
Cloud-only.

## Design Boundary

The library lives in `laserfiche-rest/` and depends only on web platform APIs.
It does not import LF Sync configuration, persistence, Trellis, or CWS types.
Callers provide:

- The API root, ending at `LFRepositoryAPI`.
- The repository ID and root entry ID.
- An access-token provider.
- A mutation guard, when mutations are allowed.
- Optionally, an injected `fetch` and request timeout for tests and hosting.

The token provider is intentional. Self-hosted username/password authentication
is documented on the V1 token endpoint, while V2 documents authorization code
with PKCE. LF Sync must not assume that a V1 password token is valid for the V2
repository API until this is confirmed against the installed server and the
approved service-account model.

Mutations default to denied. A future runtime adapter must bind the mutation
guard to `LF_SYNC_WRITE_MODE` immediately before each request.

## Capability Matrix

| Capability                            | Initial position                                 |
| ------------------------------------- | ------------------------------------------------ |
| Get entry by ID                       | Supported in V2; first slice                     |
| List folder children                  | Supported and paginated; first slice             |
| Create and reconcile folders          | Supported; first slice                           |
| Import an electronic document         | Supported; next slice                            |
| Multipart import                      | Supported; defer until server limits are known   |
| Export/download                       | Supported; consume single-use URL immediately    |
| Rename and move entries               | Supported; later core slice                      |
| Delete entries                        | Supported as a long operation; later core slice  |
| Read and write entry fields           | Supported; later metadata slice                  |
| Assign or remove a template           | Supported; later metadata slice                  |
| Search                                | Supported as a long operation; later query slice |
| Read field/template definitions       | Supported; later metadata slice                  |
| Create or modify field definitions    | Current guide is Cloud-only; blocked             |
| Create or modify template definitions | Current guide is Cloud-only; blocked             |
| Replace existing document bytes       | Current update guide is Cloud-only; blocked      |
| CWS indexing and volume migration     | No confirmed V2 equivalent; blocked              |

Blocked operations are not represented as speculative client methods. Revisit
them only after capturing the installed V2 OpenAPI document and testing the
service account's repository rights in a non-production repository.

## Provider-Neutral Integration

The current CWS submission contract creates an empty document and uploads its
bytes in a second request. V2 simple import sends metadata and bytes atomically,
so the REST client must not mimic the CWS sequence.

Before activation, introduce an internal provider-neutral interface centered on
one operation such as `archiveDocument`. The CWS implementation may continue to
perform create then upload; the REST implementation performs one import. Public
Trellis contracts and existing RPC subjects do not need to change.

The provider-neutral result must retain repository ID, entry ID, name, full
path, content hash, and provider name. Persistence column names that currently
say `cws` should be migrated separately, with compatibility for existing rows.

## Delivery Slices

1. Foundation and directories
   - Authenticated transport with token caching and one forced refresh on 401.
   - Sanitized errors and bounded request timeouts.
   - Entry parsing, safe OData pagination, folder creation, and path
     reconciliation with conflict-race recovery.
2. Atomic document transfer
   - Simple import with bytes, fields, and optional template in one request.
   - Export followed by immediate consumption of the single-use download URL.
   - File-size policy derived from the installed server configuration.
3. Entry and metadata management
   - Rename, move, template assignment, field reads/writes, and definition
     reads.
   - Preserve multi-value field semantics and distinguish replace from merge.
4. Long operations
   - Shared bounded task polling for delete, search, async export, and multipart
     import.
   - Explicit timeout, failed-task, cancellation, and expired-task outcomes.
5. Runtime adapter and shadow validation
   - Add provider-neutral internal interfaces without changing public RPCs.
   - Keep CWS selected; exercise REST reads only against a test repository.
   - Compare folder, metadata, upload, download, and hash outcomes.
6. Controlled activation
   - Add explicit provider configuration only after credentials, Swagger, API
     Server version, repository rights, upload limits, and rollback are known.
   - Preserve disabled/canary/enabled write policy and concurrency one.

## Access Checklist

Before adding runtime configuration or issuing real writes, obtain and record:

- API Server and Laserfiche Server versions.
- Installed V2 OpenAPI document from
  `https://<host>/LFRepositoryAPI/swagger/index.html`.
- Approved non-interactive authentication method and token lifetime behavior.
- Repository ID, root entry ID, service-account rights, and test folder.
- API Server request-size and multipart limits.
- Session idle timeout and expected 401 behavior.
- Field and template definitions used by LF Sync.
- Whether document update, field-definition mutation, and template-definition
  mutation exist in this installed self-hosted version.
- A disposable repository area for import, export, rename, move, metadata, and
  delete verification.

## Activation Gate

Do not wire the REST client into `runtime/register.ts`, add REST credentials to
deployment manifests, or expose a provider switch until the access checklist is
complete and an approved canary has demonstrated byte-for-byte export of an
imported document. CWS remains the only configured provider until that gate is
explicitly approved.
