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
import pLimit from 'p-limit';
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
} from './cws/index.js';
import { transform } from './transformers/index.js';
import { fetchLfTasks, finishedWork } from './fromLf.js';
import { pushToTrellis } from './utils/trellis.js';
import { DOCS_LIST, PARTNERS_LIST } from './tree.js';

type VDocList = Record<string, Link>;
type LfSyncMetaData = {
  lastSync: string;
  LaserficheEntryID: DocumentId;
  data: Record<string, string>;
};

const selfChange = new JsonPointer('/body/_meta/services/lf-sync');

const trace = makeDebug('lf-sync:trace');
const info = makeDebug('lf-sync:info');
// const debug = makeDebug('lf-sync:debug');

// Stuff from config
const { token: tokens, domain } = config.get('oada');

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

// Queue for LF calls, concurrency 1.  Wrap things and pass to limit function.
const limit = pLimit(1); // Only allow one thing to run at once by passing it to the limit function

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
  const tpWatch = new ListWatch({
    conn,
    name: 'lf-sync:to-lf',
    resume: false,
    path: PARTNERS_LIST,
    async onAddItem(_, id) {
      await onMasterId(conn, id);
    },
  });
  process.on('beforeExit', async () => tpWatch.stop()); */

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
        //  async onItem(change) {
        //    console.log('onItem CHANGE', change);
        //  },
        async onAddItem(item, docKey) {
          trace(`Got new work (new): ${join(DOCS_LIST, key, docKey)}`);
          await onDocument(conn, false, item);
        },
        async onChangeItem(change, docKey) {
          trace(change, 'onChangeItem: ');
          if (selfChange.has(change)) {
            trace('Ignoring self made change to resource.');
            return;
          }

          trace(`Got new work (changed): ${join(DOCS_LIST, key, docKey)}`);

          // Fetch resource
          let { data: item } = await oada.get({
            path: change.resource_id,
          });

          // @ts-expect-error
          await onDocument(conn, false, item);
        },
      });
      process.on('beforeExit', () => watch.stop());
    },
  });
  process.on('beforeExit', () => watch.stop());

  // Wait LF for tasks
  for await (const file of fetchLfTasks()) {
    if (file.Type !== 'Document') {
      info(`LF ${file.EntryId} is not a document. Skipping.`);
      // TODO: Move the item to _Needs_Review?
      continue;
    }

    info(`LaserFiche ${file.EntryId} queue for processing.`);

    ////// REPLACE THIS WITH THE BELOW LOGIC
    await pushToTrellis(conn, file);

    ///////////////////////////////////
    /// STILL NEED TO IMPLEMENT !!! ///
    ///////////////////////////////////
    /*
    if (in-lf-by-id list) {
      if (_type === unidentified) { 
        skip?
      } else {
        causeTrellisUpdate() /* Re-upload pdf? * /
      }
    } else {
      await pushToTrellis(conn, file);
    }
    */
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
async function onDocumentType(conn: OADAClient, tp: string, type: string) {
  // Watch for new documents of type `type`
  const path = join(PARTNERS_LIST, tp, DOCS_LIST, type);
  info('Monitoring %s for new documents of type %s', path, type);
  new ListWatch({
    conn,
    name: `lf-sync:to-lf:${tp}:${type}`,
    // Only watch for actually new items
    resume: true,
    path,
    assertItem: assertResource,
    async onAddItem(item) {
      // @ts-expect-error
      // Renamed to onDocument
      await onNewDocument(conn, tp, item);
    },
  });
  // process.on('beforeExit', async () => watch.stop());
}

// FIXME: We really shouldn't need the trading partner to be passed in.
async function onDocument(
  conn: OADAClient,
  tp: string | false,
  document: Resource
) {
  if (Object.keys(document).filter((k) => !k.startsWith('_')).length === 0) {
    trace('Document transcription still in progress... Skipping.');
    return;
  }

  /// THIS NEEDS TO BE UPDATED TO TAKE THE OLD METADATA
  const lfData = transform(document);

  trace('Fetching vdocs for %s', document._id);
  // TODO: Should we loop over non-PDFs?
  const r = await conn.get({ path: join(document._id, '_meta/vdoc') });
  // FIXME: Make proper format and assert the type
  // FIXME: r.data['pdf'] => r.data (and .../pdf/..) in the GET url after fixing extra put to vdoc/pdf rather than vdoc/pdf/<hash> in target-helper
  //@ts-expect-error
  const vdocs = r.data['pdf'] as VDocList;

  // TODO: Replace this block w/ proper master data lookup
  // We know that we came from a trading-partner index, then us our "standard name" for that tradiing partner
  if (tp) {
    const { data: name } = await conn.get({
      path: join(PARTNERS_LIST, tp, 'name'),
    });
    // NOTE: We really should be getting the name from the data (through a masterdata match), but for now FL is "most" right.
    lfData['Entity'] = name?.toString() || '';
    lfData['Share Mode'] = 'Shared To Smithfield';
  }

  // Note: Each "vdoc" is a LF Document itself (some "documents" have multiple attachments)
  for await (const [key, val] of Object.entries(vdocs)) {
    // TODO: Remove when target-helper vdoc extra link bug is fiexed
    if (key === '_id') continue;

    let syncMetadata = await fetchSyncMetadata(conn, document._id, key);

    // Document is new to LF
    if (!syncMetadata) {
      info('Document is new to LF');
      trace('Creating LF document.');
      const lfDocument = await createGenericDocument({
        name: `${document._id}-${key}.pdf`,
      });

      trace('Fetching PDF for %s', document._id);
      const { data: pdf } = await conn.get({
        path: val._id,
      });
      if (!Buffer.isBuffer(pdf)) {
        throw new TypeError(`Expected PDF to be a Buffer, got ${typeof pdf}`);
      }

      trace('Streaming fetched PDF to Laserfiche');
      await limit(async () =>
        pipeline(
          Readable.from(pdf),
          streamUpload(lfDocument.LaserficheEntryID, 'pdf', pdf.length),
          new PassThrough()
        )
      );

      info(`Created LF document ${lfDocument.LaserficheEntryID}`);
      syncMetadata = {
        lastSync: new Date().toISOString(),
        LaserficheEntryID: lfDocument.LaserficheEntryID,
        data: lfData,
      };
    }

    trace(`Updating LF metadata for LF ${syncMetadata.LaserficheEntryID}`);
    await setMetadata(
      syncMetadata.LaserficheEntryID,
      lfData,
      lfData['Document Type']
    );

    trace(`Moving the LF document to _Incoming for filing`);
    await moveEntry(syncMetadata.LaserficheEntryID, '/_Incoming');

    trace('Recording lf-sync metadata to Trellis document');
    await conn.put({
      path: join(document._id, '_meta/services/lf-sync/', key),
      data: syncMetadata,
    });

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
): Promise<LfSyncMetaData | void> {
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
}
