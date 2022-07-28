/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Import this first to setup the environment
import config from './config.js';

import { PassThrough, Readable } from 'node:stream';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import makeDebug from 'debug';
// Promise queue to avoid spamming LF
import pQueue from 'p-queue';
import { JsonPointer } from 'json-ptr';

import { OADAClient, connect } from '@oada/client';
import type { Link } from '@oada/types/oada/link/v1';
import Resource, {
  assert as assertResource,
} from '@oada/types/oada/resource.js';
import { ListWatch } from '@oada/list-lib';

import {
  DocumentId,
  streamUpload,
  setMetadata,
  moveEntry,
  createGenericDocument,
  DocumentEntry,
  getEntryId,
} from './cws/index.js';
import { transform } from './transformers/index.js';
import { fetchLfTasks, finishedWork } from './fromLf.js';
import { pushToTrellis } from './utils/trellis.js';
import { BY_LF_PATH, DOCS_LIST, MASTERID_LIST } from './tree.js';

type VDocList = Record<string, Link>;
type LfSyncMetaData = {
  lastSync?: string;
  LaserficheEntryID?: DocumentId;
  data?: Record<string, string>;
};

const selfChange = new JsonPointer('/body/_meta/services/lf-sync');

const trace = makeDebug('lf-sync:trace');
const info = makeDebug('lf-sync:info');
// const debug = makeDebug('lf-sync:debug');
const error = makeDebug('lf-sync:error');

// Stuff from config
const { token: tokens, domain } = config.get('oada');

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

// This queue limits the number of *processing documents* at once.
// OADA is rate limited by @oada/client
// LF is *NOT* rate limited, but only has sparse calls per *pending document* at this time
const work = new pQueue({ concurrency: 1 });

/**
 * Start-up for a given user (token)
 */
async function run(token: string) {
  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain }));

  /*
  info('Monitoring %s for new/current partners', PARTNERS_LIST);
  const watch = new ListWatch({
    conn,
    name: 'lf-sync:to-lf',
    resume: false,
    path: PARTNERS_LIST,
    onAddItem(_, masterId) {
      // No need to start them sequentially (service start is several minutes otherwise)
      // TODO: Maybe p-limit this to something largish?
     onMasterId(conn, masterId);
    }
  });
  process.on('beforeExit', async () => watch.stop()); */

  // Watching "self" documents are /bookmarks/trellisfw/documents
  const watch = new ListWatch({
    conn,
    name: 'lf-sync:to-lf-own',
    resume: false,
    path: DOCS_LIST,
    onAddItem(_, key) {
      // Watch documents at /bookmarks/trellisfw/documents/<type=key>
      const path = join(DOCS_LIST, key);
      trace(`Monitoring ${path} for new/current document types`);

      const watch = new ListWatch({
        conn,
        name: `lf-sync:to-lf-own`,
        resume: true,
        path,
        assertItem: assertResource,
        // TODO: Can I use onItem here? I don't really recall way I couldn't...
        async onAddItem(item, docKey) {
          trace(`Got new work (new): ${join(path, docKey)}`);
          work.add(() => onDocument(conn, false, item));
        },
        async onChangeItem(change, docKey) {
          if (selfChange.has(change)) {
            trace('Ignoring self made change to resource.');
            return;
          }

          trace(`Got change work: ${join(path, docKey)}`);

          // Fetch resource
          let data = await oada.get({
            path: change.resource_id,
          });
          let item = data.data as Resource;

          work.add(() => onDocument(conn, false, item));
        },
      });
      process.on('beforeExit', () => watch.stop());
    },
  });
  process.on('beforeExit', () => watch.stop());

  // Wait LF for tasks
  for await (const file of fetchLfTasks()) {
    if (file.Type !== 'Document') {
      info(`LF ${file.EntryId} is not a document. Moving to _NeedsReview.`);
      await moveEntry(file, '/_NeedsReview');

      continue;
    }

    info(`LaserFiche ${file.EntryId} queue for processing.`);
    let doc = await lookupByLf(oada, file);

    if (doc) {
      trace('Document already in Trellis! %s', doc._id);
      // causeTrellisUpdate(doc)
    } else {
      await pushToTrellis(conn, file);
    }
  }
}

/* async function onMasterId(conn: OADAClient, id: string) {
  const path = join(PARTNERS_LIST, id, DOCS_LIST);
  info('Monitoring %s for new/current document types', path);
  const watch = new ListWatch({
    conn,
    name: `lf-sync:to-lf:${id}`,
    resume: false,
    path,Oh shoot.... I gu es
    async onAddItem(_, type) {
      await onDocumentType(conn, id, type);
    },
  });
  process.on('beforeExit', async () => watch.stop());
} */

//@ts-expect-error
async function onDocumentType(
  conn: OADAClient,
  masterId: string,
  type: string
) {
  // Watch for new documents of type `type`
  const path = join(MASTERID_LIST, masterId, DOCS_LIST, type);
  info('Monitoring %s for new documents of type %s', path, type);
  const watch = new ListWatch({
    conn,
    name: `lf-sync:to-lf:${masterId}:${type}`,
    // Only watch for actually new items
    resume: true,
    path,
    assertItem: assertResource,
    async onAddItem(item) {
      work.add(() => onDocument(conn, masterId, item));
    },
  });
  process.on('beforeExit', async () => watch.stop());
}

// FIXME: We really shouldn't need the trading partner to be passed in.
async function onDocument(
  conn: OADAClient,
  masterId: string | false,
  doc: Resource
) {
  // aka, an empty object
  if (Object.keys(doc).filter((k) => !k.startsWith('_')).length === 0) {
    trace('Document has no data. Skipping.');
    return;
  }

  /// THIS NEEDS TO BE UPDATED TO TAKE THE OLD METADATA
  const lfData = transform(doc);

  trace('Fetching vdocs for %s', doc._id);
  const vdocs = await getPdfVdocs(conn, doc);

  // TODO: Replace block with proper master data lookup
  if (masterId) {
    const name = await tradingPartnerNameByMasterId(conn, masterId);

    lfData['Entity'] = name;
    lfData['Share Mode'] = 'Shared To Smithfield';
  }

  // Each "vdoc" is a single LF Document (In trellis "documents" have multiple attachments)
  for await (const [key, val] of Object.entries(vdocs)) {
    // TODO: Remove when target-helper vdoc extra link bug is fiexed
    if (key === '_id') continue;

    let syncMetadata = await fetchSyncMetadata(conn, doc._id, key);

    // Document is new to LF
    if (!syncMetadata.LaserficheEntryID) {
      info('Document is new to LF');
      const lfId = await uploadPdfToLf(oada, val, key);

      info(`Created LF document ${lfId}`);
      syncMetadata.LaserficheEntryID = lfId;
    }

    // Update document data
    // TODO: THIS IS WHERE I NEED TO DO THAT DON"T OVERRIGHT CHECK
    syncMetadata.data = lfData;

    trace(`Updating LF metadata for LF ${syncMetadata.LaserficheEntryID}`);
    await setMetadata(
      syncMetadata.LaserficheEntryID,
      syncMetadata.data,
      syncMetadata.data['Document Type']
    );

    trace(`Moving the LF document to _Incoming for filing`);
    await moveEntry(syncMetadata.LaserficheEntryID, '/_Incoming');

    trace('Recording lf-sync metadata to Trellis document');
    updateSyncMetadata(oada, doc, key, syncMetadata);

    // Let the LF monitor know we finished if this doc happens to be from LF
    trace(`Marked ${syncMetadata.LaserficheEntryID} as finished.`);
    finishedWork(syncMetadata.LaserficheEntryID);
  }
}

// Start the service
await Promise.all(tokens.map(async (element) => run(element)));

async function fetchSyncMetadata(
  oada: OADAClient,
  id: string,
  key: string
): Promise<LfSyncMetaData> {
  try {
    const r = await oada.get({
      path: join(id, '_meta/services/lf-sync', key),
    });
    // FIXME: Make proper format and assert type
    return r.data as LfSyncMetaData;
  } catch (cError: any) {
    if (cError?.status !== 404) {
      trace(cError, `Error fetching ${id}'s sync metadata for vdoc ${key}!`);
      throw cError;
    }
  }

  return {};
}

//// TRELLIS
// Query the Documents-By-LaserFicheID index managed by this service
// for the related Trellis document
async function lookupByLf(
  oada: OADAClient,
  file: DocumentEntry
): Promise<Resource | undefined> {
  // Check if document is already in Trellis. If so, trigger a re-process. Otherwise, upload it to Trellis.
  try {
    let { data } = await oada.get({
      path: join(BY_LF_PATH, getEntryId(file).toString()),
    });

    // TODO: Proper assert?
    return data as Resource;
  } catch (cError: any) {
    if (cError?.status !== 404) {
      error(cError, 'Unexpected error with Trellis!');
      throw cError;
    }
  }

  return;
}

// Get the list of **PDF** vdocs associated with a Trellis document.
async function getPdfVdocs(
  oada: OADAClient,
  doc: Resource | Link
): Promise<VDocList> {
  // FIXME: r.data['pdf'] => r.data (and .../pdf/..) in the GET url after fixing extra put to vdoc/pdf rather than vdoc/pdf/<hash> in target-helper
  const r = await oada.get({ path: join(doc._id, '_meta/vdoc') });

  //@ts-expect-error
  // FIXME: Make proper format and assert the type
  return r.data['pdf'] as VDocList;
}

// Upload a PDF from Trellis to LaserFiche as a new LF resource
async function uploadPdfToLf(
  oada: OADAClient,
  doc: Resource | Link,
  key: string
): Promise<DocumentId> {
  trace('Creating LF document.');
  const lfDocument = await createGenericDocument({
    name: `${doc._id}-${key}.pdf`,
  });

  trace('Fetching PDF for %s', doc._id);
  const { data: pdf } = await oada.get({
    path: doc._id,
  });
  if (!Buffer.isBuffer(pdf)) {
    throw new TypeError(`Expected PDF to be a Buffer, got ${typeof pdf}`);
  }

  trace('Streaming fetched PDF to Laserfiche');
  await pipeline(
    Readable.from(pdf),
    streamUpload(lfDocument.LaserficheEntryID, 'pdf', pdf.length),
    new PassThrough()
  );

  return lfDocument.LaserficheEntryID;
}

// Lookup the English name for a Trading partner by masterid
async function tradingPartnerNameByMasterId(
  oada: OADAClient,
  masterId: string
): Promise<string> {
  const { data: name } = await oada.get({
    path: join(MASTERID_LIST, masterId, 'name'),
  });

  return (name || '').toString();
}

// Update the LF sync metadata in a Trellis
async function updateSyncMetadata(
  oada: OADAClient,
  doc: Resource,
  key: string,
  syncMetadata: LfSyncMetaData
) {
  await oada.put({
    path: join(doc._id, '_meta/services/lf-sync/', key),
    data: {
      ...syncMetadata,
      lastSync: new Date().toISOString(),
    },
  });
}
