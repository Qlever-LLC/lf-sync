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

import debug from 'debug';
// Promise queue to avoid spamming LF
import pLimit from 'p-limit';

import { OADAClient, connect } from '@oada/client';
import Resource, {
  assert as assertResource,
} from '@oada/types/oada/resource.js';
import { ListWatch } from '@oada/list-lib';

import { createDocument, streamUpload } from './cws/index.js';
import transformers from './transformers/index.js';

const trace = debug('lf-sync:trace');
const info = debug('lf-sync:info');
const warn = debug('lf-sync:warn');

/**
 * Top level list to check/watch for all trading-partners
 */
const PARTNERS_LIST = '/bookmarks/trellisfw/trading-partners/masterid-index';
/**
 * List to check/watch for a trading-partner's document types
 */
const PARTNER_DOCS_LIST = '/bookmarks/trellisfw/documents';

const LF_ID_PATH = '_meta/services/lf-sync/LaserficheEntryID';

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
  process.on('beforeExit', async () => tpWatch.stop());
}

const masterIdWatches = new Map<{ conn: OADAClient; id: string }, ListWatch>();
async function onMasterId(conn: OADAClient, id: string) {
  if (masterIdWatches.has({ conn, id })) {
    // Already watching this
    warn('Duplicate call to onMasterId for id %s', id);
    return;
  }

  const path = `${PARTNERS_LIST}/${id}`;
  info('Monitoring %s for new/current document types', path);
  const watch = new ListWatch({
    conn,
    name: `lf-sync:to-lf:${id}`,
    resume: false,
    path,
    async onAddItem(_, type) {
      await onDocumentType(conn, id, type);
    },
  });
  masterIdWatches.set({ conn, id }, watch);
  process.on('beforeExit', async () => watch.stop());
}

const documentTypeWatches = new Map<
  { conn: OADAClient; tp: string; type: string },
  ListWatch
>();
async function onDocumentType(conn: OADAClient, tp: string, type: string) {
  if (documentTypeWatches.has({ conn, tp, type })) {
    // Already watching this
    warn('Duplicate call to onDocumentType for id %s, type %s', tp, type);
    return;
  }

  // Watch for new documents of type `type`
  const path = `${PARTNER_DOCS_LIST}/${tp}/${PARTNER_DOCS_LIST}/${type}`;
  info('Monitoring %s for new documents of type %s', path, type);
  const watch = new ListWatch({
    conn,
    name: `lf-sync:to-lf:${tp}:${type}`,
    // Only watch for actually new items
    resume: true,
    path,
    assertItem: assertResource,
    async onAddItem(item, id) {
      await onNewDocument(conn, item, id);
    },
  });
  documentTypeWatches.set({ conn, tp, type }, watch);
  process.on('beforeExit', async () => watch.stop());
}

async function onNewDocument(
  conn: OADAClient,
  document: Resource,
  path: string
) {
  // Verify that the document is not already in LF
  try {
    const { data: lfId } = (await conn.get({
      path: join(document._id, LF_ID_PATH),
    })) as { data: string };

    if (lfId) {
      warn('%s already in Laserfiche (EntryID: %s).', document._id, lfId);
      return;
    }
  } catch (cError: unknown) {
    // @ts-expect-error catches in ts are a pain
    if (cError?.status !== 404) {
      trace(cError, 'Unexpected error!');
      throw cError;
    }
  }

  // NOTE: It would be nice if oada/list-lib would give you the `*` values from `itemsPath`
  const masterID = path.split('/')[1]!;
  const documentType = document._type;

  const transformer = transformers.get(documentType);
  if (!transformer) {
    warn('Unknown document type %s. Skipping.', documentType);
    return;
  }

  const metadata = transformer.metadata(document);
  trace(
    { document, metadata, template: transformer.lfTemplate },
    'Attempting to transform document'
  );

  // Determine entity name from trading-partner
  const { data: partnerName } = await conn.get({
    path: join(PARTNERS_LIST, masterID, 'name'),
  });
  trace('Trading partner/Entity name: %s', partnerName);

  const lfDocument = await limit(async () =>
    createDocument({
      path: '/_Incoming',
      name: `${document._id}.pdf`,
      template: transformer.lfTemplate,
      metadata: {
        'Entity': partnerName?.toString() ?? 'unknown',
        'Share Mode': 'Shared To Smithfield',
        ...metadata,
      },
    })
  );
  trace('Created Laserfiche document: %s', lfDocument);

  trace('Fetching PDF for %s', document._id);
  const { data: pdf } = await conn.get({
    path: join(document._id, '_meta/vdoc/pdf'),
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

  trace('Recording Laserfiche ID to resource meta');
  await conn.put({
    path: join(document._id, '_meta/services/lf-sync/LaserficheEntryID'),
    data: lfDocument.LaserficheEntryID,
  });

  info(
    'Created Laserfiche entry %s for document %s',
    lfDocument.LaserficheEntryID,
    document._id
  );
}

// Start the service
await Promise.all(tokens.map(async (element) => run(element)));
