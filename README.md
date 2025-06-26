# Qlever-LLC/lf-sync

[![Docker Pulls](https://img.shields.io/docker/pulls/Qlever-LLC/lf-sync)][dockerhub]
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![License](https://img.shields.io/github/license/Qlever-LLC/lf-sync)](LICENSE)

[dockerhub]: https://hub.docker.com/repository/docker/Qlever-LLC/lf-sync
[oada reference api server]: https://github.com/OADA/server

### Environment

```sh
NODE_TLS_REJECT_UNAUTHORIZED=0
CWS_USER=
CWS_PASSWORD=
CWS_TIMEOUT=20000
LF_SYNC_CONCURRENCY= # number of concurrent sync jobs
DEBUG=
LF_SYNC_WATCH_OWN=false
PROM_PORT= #Prometheus Metrics Port
SYNC_JOB_TIMEOUT=600000
ENTRY_JOB_TIMEOUT=60000000
DOMAIN= # Trellis domain e.g., localhost:3006
TOKEN= # Trellis token
CWS_API=https://localhost:3007/CWSAPI/
CWS_SERVER= #Server Name, e.g., servername.domain.com
CWS_REPO= #CWS Repository name
LF_INCOMING=_Incoming #Where we drop files in CWS for the filing workflow
```

### Jobs

The service will run the following jobs:

#### `get-lf-entry`

```typescript
const job = {
  service: "lf-sync",
  type: "get-lf-entry",
  config: {
    doc: "resources/abc123", // a trellis document (the json parent doc with vdocs)
  },
};

let { result } = await doJob(job);
/*
  {
    "453899066e7e8792178b9ee1fa882786": { // keys corresponding to each vdoc
      "fields": {
        "Metadata Field A": "value A",
        "Metadata Field B": "value B",
        ...
      },
      "LaserficheEntryID": 1111111,
      "lastSync": "2024-07-01T20:54:36.499Z",
      "path": "\\Some\\Place\\In\\Laserfiche\\abc123.pdf",
    }
  }
*/
```

#### `sync-doc`

Generally, this job is triggered by dropping any document in the
trading-partners docs endpoints:

`/bookmarks/trellisfw/trading-partners/<trading partner key>/bookmarks/trellisfw/documents/<doc type>/<doc key>`

The configuration appears as follows:

```typescript
const job = {
  service: "lf-sync",
  type: "sync-doc",
  config: {
    doc: {
      id: "resources/abc123", //a trellis document (the json parent doc with vdocs)
    },
    tpKey: "/tradingpartnerabc123", //a trellis trading partner key from the /bookmarks/trellisfw/trading-partners/ resource
  },
};

let { result } = await doJob(job);
/*
  {
    "453899066e7e8792178b9ee1fa882786": { // keys corresponding to each vdoc
      "fields": {
        "Metadata Field A": "value A",
        "Metadata Field B": "value B",
        ...
      },
      "LaserficheEntryID": 1111111,
      "lastSync": "2024-07-01T20:54:36.499Z",
    }
  }
*/
```
