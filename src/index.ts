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

import { join } from 'node:path';

import makeDebug from 'debug';
// Promise queue to avoid spamming LF
import pQueue from 'p-queue';
import { JsonPointer } from 'json-ptr';
import { CronJob } from 'cron';

import { OADAClient, connect } from '@oada/client';
import Resource, {
  assert as assertResource,
} from '@oada/types/oada/resource.js';
import { ListWatch } from '@oada/list-lib';

import { DOCS_LIST, LF_AUTOMATION_FOLDER, MASTERID_LIST } from './tree.js';
import { transform } from './transformers/index.js';
import {
  DocumentEntry,
  browse,
  getMetadata,
  moveEntry,
  setMetadata,
  EntryIdLike,
  getEntryId,
  createDocument,
  EntryId,
} from './cws/index.js';
import {
  LfSyncMetaData,
  fetchSyncMetadata,
  getBuffer,
  getPdfVdocs,
  has,
  lookupByLf,
  pushToTrellis,
  tradingPartnerNameByMasterId,
  updateSyncMetadata,
} from './utils.js';

const selfChange = new JsonPointer('/body/_meta/services/lf-sync');

const trace = makeDebug('lf-sync:trace');
const info = makeDebug('lf-sync:info');
const warn = makeDebug('lf-sync:warn');

// Stuff from config
const { token: tokens, domain } = config.get('oada');
const CONCURRENCY = config.get('concurrency');
const LF_POLL_RATE = config.get('laserfiche.pollRate');
const LF_JOB_TIMEOUT = config.get('laserfiche.timeout');

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

// This queue limits the number of *processing documents* at once.
// OADA is rate limited by @oada/client
// LF is *NOT* rate limited, but only has sparse calls per *pending document* at this time
const work = new pQueue({ concurrency: CONCURRENCY });
let lfCleanup: (id: EntryIdLike) => void | undefined;

/**
 * Start-up for a given user (token)
 */
async function run(token: string) {
  info('Service: lf-sync');
  info(`Version: ${process.env.npm_package_version}`);

  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain }));

  // Watch for new trading partner documents to process
  if (config.get('watch.partners')) {
    watchPartnerDocs(conn, (masterId, item) =>
      work.add(() => processDocument(conn, masterId, item))
    );
  }

  // Watch for new "self" documents to process
  if (config.get('watch.own')) {
    watchSelfDocs(conn, (item) =>
      work.add(() => processDocument(conn, false, item))
    );
  }

  if (config.get('watch.lf')) {
    lfCleanup = watchLaserfiche(async (file) => {
      info(`LaserFiche ${file.EntryId} queue for processing.`);
      const document = await lookupByLf(conn, file);

      if (document) {
        info('Reprocessing Trellis document %s', document._id);
        work.add(() => processDocument(conn, false, document));
      } else {
        work.add(() => pushToTrellis(conn, file));
      }
    });
  }
}

// Start the service
await Promise.all(tokens.map(async (element) => run(element)));

// FIXME: We really shouldn't need the trading partner to be passed in.
async function processDocument(
  conn: OADAClient,
  masterId: string | false,
  document: Resource
) {
  const fieldList = transform(document);

  trace('Fetching vdocs for %s', document._id);
  const vdocs = await getPdfVdocs(conn, document);

  // TODO: Replace block with proper master data lookup
  // We should we probably just use the data from the PDF (target), but without a
  // proper master data lookup, we can't resolve trading partner aliases. So for now,
  // we just use the name as known in Trellis.
  if (masterId) {
    const name = await tradingPartnerNameByMasterId(conn, masterId);
    fieldList.Entity = name;
  }

  // Each "vdoc" is a single LF Document (In trellis "documents" have multiple attachments)
  for await (const [key, value] of Object.entries(vdocs)) {
    // TODO: Remove when target-helper vdoc extra link bug is fiexed
    if (key === '_id') continue;

    const syncMetadata = await fetchSyncMetadata(conn, document._id, key);
    let currentFields = {} as LfSyncMetaData['fields'];

    // Document is new to LF
    if (syncMetadata.LaserficheEntryID) {
      // Fetch the current LF fields to compare for changes
      const metadata = await getMetadata(syncMetadata.LaserficheEntryID);
      currentFields = metadata.LaserficheFieldList.reduce(
        (o, f) =>
          has(f, 'Value') && f.Value !== '' ? { ...o, [f.Name]: f.Value } : o,
        {}
      );
    }

    if (!syncMetadata.fields) {
      syncMetadata.fields = {};
    }

    currentFields = Object.assign({}, syncMetadata.fields, currentFields);

    // Only take new automation values if not manually changed in the past
    for (const [key, value] of Object.entries(fieldList)) {
      if (syncMetadata.fields[key] === currentFields[key]) {
        currentFields[key] = value;
      }
    }

    syncMetadata.fields = currentFields;

    // Aka, an empty object
    if (Object.keys(syncMetadata.fields).length === 0) {
      trace(`Document vdoc ${key} has no data yet. Skipping.`);
      continue;
    }

    // Upsert into LF
    if (syncMetadata.LaserficheEntryID) {
      trace(`Updating LF metadata for LF ${syncMetadata.LaserficheEntryID}`);
      await setMetadata(
        syncMetadata.LaserficheEntryID,
        syncMetadata.fields || {},
        syncMetadata.fields['Document Type']
      );

      trace(`Moving the LF document to _Incoming for filing`);
      await moveEntry(syncMetadata.LaserficheEntryID, '/_Incoming');

      // New to LF
    } else {
      info('Document is new to LF');

      trace('Uploading document to Laserfiche');
      const lfDocument = await createDocument({
        name: `${document._id}-${key}.pdf`,
        path: '/_Incoming',
        metadata: syncMetadata.fields || {},
        template: syncMetadata.fields['Document Type'],
        buffer: await getBuffer(conn, value),
      });

      info(`Created LF document ${lfDocument.LaserficheEntryID}`);
      syncMetadata.LaserficheEntryID = lfDocument.LaserficheEntryID;
    }

    trace('Recording lf-sync metadata to Trellis document');
    updateSyncMetadata(oada, document, key, syncMetadata);

    // Let the LF monitor know we finished if this doc happens to be from LF
    // FIXME: This cleanup channel seems hacked in.
    if (lfCleanup) {
      trace(`Marked ${syncMetadata.LaserficheEntryID} as finished.`);
      lfCleanup(syncMetadata.LaserficheEntryID);
    }
  }
}

function watchPartnerDocs(
  conn: OADAClient,
  work: (masterId: string, item: Resource) => void
) {
  info('Monitoring %s for new/current partners', MASTERID_LIST);
  const watch = new ListWatch({
    conn,
    name: 'lf-sync:to-lf',
    resume: false,
    path: MASTERID_LIST,
    onAddItem(_, masterId) {
      const documentPath = join(MASTERID_LIST, masterId, DOCS_LIST);

      info('Monitoring %s for new/current document types', documentPath);
      const watch = new ListWatch({
        conn,
        name: `lf-sync:to-lf:${masterId}`,
        resume: false,
        path: documentPath,
        onAddItem(_, type) {
          // Watch for new documents of type `type`
          const path = join(documentPath, type);

          info('Monitoring %s for new documents of type %s', path, type);
          const watch = new ListWatch({
            conn,
            name: `lf-sync:to-lf:${masterId}:${type}`,
            // Only watch for actually new items
            resume: true,
            path,
            assertItem: assertResource,
            onAddItem(item) {
              work(masterId, item);
            },
          });
          process.on('beforeExit', async () => watch.stop());
        },
      });
      process.on('beforeExit', async () => watch.stop());
    },
  });
  process.on('beforeExit', async () => watch.stop());
}

function watchSelfDocs(
  conn: OADAClient,
  work: (item: Resource) => Promise<void>
) {
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
        async onAddItem(item, documentKey) {
          trace(`Got work (new): ${join(path, documentKey)}`);
          await work(item);
        },
        async onChangeItem(change, documentKey) {
          if (selfChange.has(change)) {
            trace('Ignoring self made change to resource.');
            return;
          }

          trace(`Got work (change): ${join(path, documentKey)}`);

          // Fetch resource
          const data = await oada.get({
            path: change.resource_id,
          });
          const item = data.data as Resource;

          await work(item);
        },
      });
      process.on('beforeExit', async () => watch.stop());
    },
  });
  process.on('beforeExit', async () => watch.stop());
}

function watchLaserfiche(
  task: (file: DocumentEntry) => void
): (id: EntryIdLike) => void {
  const workQueue = new Map<number, number>();

  let job = new CronJob(`*/${LF_POLL_RATE} * * * * *`, async () => {
    const start = new Date();

    for (const [id, startTime] of workQueue.entries()) {
      if (start.getTime() > startTime + LF_JOB_TIMEOUT) {
        warn(`LF ${id} work never completed. moved to _NeedsReview`);
        await moveEntry(id as EntryId, '/_NeedsReview');
        workQueue.delete(id);
      }
    }

    trace(`${start.toISOString()} Polling LaserFiche.`);

    const files = await browse(LF_AUTOMATION_FOLDER);
    for (const file of files) {
      if (!workQueue.has(file.EntryId)) {
        if (file.Type !== 'Document') {
          info(`LF ${file.EntryId} not a document. Moved to _NeedsReview.`);
          await moveEntry(file, '/_NeedsReview');

          continue;
        }

        workQueue.set(file.EntryId, Date.now());

        // Do work
        task(file);
      }
    }
  });

  job.start();

  return (id: EntryIdLike) => {
    workQueue.delete(getEntryId(id));
  };
}
