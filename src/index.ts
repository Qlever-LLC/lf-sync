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
import { pipeline } from 'node:stream/promises';

import debug from 'debug';
import got from 'got';

import { Change, ListWatch } from '@oada/list-lib';
import { OADAClient, connect } from '@oada/client';

import { createDocument, streamUpload } from './cws/index.js';
import transformers from './transformers/index.js';
import tree from './tree.js';

const trace = debug('lf-sync:trace');
const info = debug('lf-sync:info');
const warn = debug('lf-sync:warn');
const error = debug('lf-sync:error');

// Stuff from config
const { token: tokens, domain } = config.get('oada');

// FIXME: Should be config?
// FIXME: Should include `masterid-index` once it is a resource
// ADB: I guess not config, because you can't decouple this from the tree embedded in this service
const BASE_PATH = '/bookmarks/trellisfw/trading-partners';

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

// Client to fetch binary objects
const client = got.extend({
  prefixUrl: `https://${domain}`,
  https: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  },
  timeout: {
    request: 10_000,
  },
});

/**
 * Start-up for a given user (token)
 */
async function run(token: string) {
  // Connect to the OADA API
  const conn = oada
    ? oada.clone(token)
    : (oada = await connect({ token, domain }));

  // For (const sync of toLF) {
  return new ListWatch({
    conn,
    tree,
    // FIXME: Remove masterid-index once it is a resources
    itemsPath: `$.masterid-index.*.bookmarks.trellisfw.documents.*.*`,
    name: 'lf-sync:to-lf',
    resume: true,
    path: BASE_PATH,
    onAddItem: syncNewDocument(conn),
  });
  // }
}

await Promise.all(tokens.map(async (token) => run(token)));

function syncNewDocument(conn: OADAClient) {
  const http = client.extend({
    headers: {
      Authorization: `Bearer ${conn.getToken()}`,
    },
  });

  // FIXME: What happens if this throws?
  // FIXME: doc is not of type Change
  return async (document: Change, path: string) => {
    // NOTE: It would be nice if oada/list-lib would give you the `*` values from `itemsPath`
    const parts = path.split('/');
    const masterid = parts[2];
    const documentId = parts[parts.length - 1];
    const documentType = document._type as string;

    const transformer = transformers.get(documentType);
    if (!transformer) {
      warn(`Unknown document type ${documentType}. Skipping.`);
      return;
    }

    const metadata = transformer.metadata(document);
    trace('Template', transformer.lfTemplate);
    trace('Metadata', metadata);

    // Determine entity name from trading-partner
    const { data: partnerName } = await conn.get({
      path: `${BASE_PATH}/masterid-index/${masterid}/name`,
    });
    trace('Trading partner/Entity name:', partnerName);

    const lfDocument = await createDocument({
      path: '/../../_Incoming',
      name: `${documentId}.pdf`,
      template: transformer.lfTemplate,
      metadata: {
        'Entity': partnerName?.toString() ?? 'unknown',
        // FIXME: How to know???
        'Share Mode': 'Shared To Smithfield',
        ...metadata,
      },
    } as const);
    trace('Created LF document:', lfDocument);

    // Fetch fetch and upload the PDF document
    trace(`Fetching PDF: ${document._id}/_meta/vdoc/pdf`);
    try {
      const pdf = await http.get(`${document._id}/_meta/vdoc/pdf`).buffer();
      await pipeline(
        Readable.from(pdf),
        streamUpload(lfDocument.LaserficheEntryID, 'pdf', pdf.length),
        new PassThrough()
      );
      trace('Uploaded to LF');
    } catch (cError: unknown) {
      // FIXME: oada/list-lib doesn't catch errors?
      error(cError);
    }

    // FIXME: We really should do a streaming upload ...
    // const upload = chunkedUpload(body.LaserficheEntryID);
    // await pipeline(pdf, upload);
    trace('Recording LF ID to resource meta');
    await conn.put({
      path: `/${document._id}/_meta/services/lf-sync/LaserficheEntryID`,
      data: lfDocument.LaserficheEntryID,
    });

    info(
      `Created LF entry ${lfDocument.LaserficheEntryID} for document ${documentId} (${document._id})`
    );
  };
}
