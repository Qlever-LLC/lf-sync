# Laserfiche Self-Hosted REST Client

This is an unwired Repository API V2 client for the future LF Sync provider. It
does not read environment variables and is not registered by the LF Sync
runtime.

```ts
import { LaserficheRestClient } from "./mod.ts";

const client = new LaserficheRestClient({
  apiBaseUrl: "https://laserfiche.example/LFRepositoryAPI",
  repositoryId: "repository-id",
  getAccessToken: async ({ forceRefresh }) => {
    return await approvedTokenProvider.get({ forceRefresh });
  },
  mutationGuard: () => {
    if (!writesAreEnabled()) throw new Error("Laserfiche writes are disabled");
  },
});

const directory = await client.ensureDirectory("/FSQA/trading-partners/Acme");
```

The caller owns credential acquisition. Do not implement V2 password login
without confirming it against the installed self-hosted Swagger document;
Laserfiche currently documents username/password on V1 and authorization code
with PKCE on V2.

Mutations are denied when `mutationGuard` is omitted. The guard runs immediately
before each mutating API operation. The future LF Sync adapter must use it to
enforce `LF_SYNC_WRITE_MODE`.

See `../docs/self-hosted-rest-api-plan.md` for capability boundaries and the
activation checklist.
