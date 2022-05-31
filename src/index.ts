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
import { join } from 'node:path';

import got from 'got';
import debug from 'debug';
import pLimit from 'p-limit'; // promise queue to avoid spamming LF

import { ListWatch } from '@oada/list-lib';
import { OADAClient, connect } from '@oada/client';
import Resource, { is as isResource } from '@oada/types/oada/resource.js';

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
// ADB: I guess not config, because you can't decouple this from the tree embedded in this service
const BASE_PATH = '/bookmarks/trellisfw/trading-partners/masterid-index';
const LF_ID_PATH = '_meta/services/lf-sync/LaserficheEntryID';

/**
 * Shared OADA client instance?
 */
let oada: OADAClient;

// queue for LF calls, concurrency 1.  Wrap things and pass to limit function.
const limit = pLimit(1); // only allow one thing to run at once by passing it to the limit function

// Client to fetch binary objects
const client = got.extend({
  prefixUrl: `https://${domain}`,
  https: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  },
  timeout: {
    request: 10000,
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

  return new ListWatch({
    conn,
    tree,
    itemsPath: `$.*.bookmarks.trellisfw.documents.*.*`,
    name: 'lf-sync:to-lf',
    resume: true,
    path: BASE_PATH,
    onAddItem: newDocument(conn),
  });
}

// Start the service
await Promise.all(tokens.map(run));

function newDocument(oada: OADAClient) {
  const http = client.extend({
    headers: {
      Authorization: `Bearer ${oada.getToken()}`,
    },
  });

  return async function (doc: Resource, path: string) {
    try {
      if (!isResource(doc)) {
        error('@oada/list-lib gave a non-resource to onAddItem callback?');
        return;
      }

      // Verify that the document is not already in LF
      try {
        const { data: lfId } = await oada.get({
          path: join(doc._id, LF_ID_PATH),
        });

        if (lfId) {
          warn(`${doc._id} already in Laserfiche (EntryID: ${lfId}).`);
          return;
        }
      } catch (e: any) {
        if (e.status !== 404) {
          trace('Unexpected error! %s', e);
          throw e;
        }
      }

      // NOTE: It would be nice if oada/list-lib would give you the `*` values from `itemsPath`
      const masterid = path.split('/')[1] as string;
      const docType = doc._type;

      const transformer = transformers.get(docType);
      if (!transformer) {
        warn(`Unknown document type ${docType}. Skipping.`);
        return;
      }

      const metadata = transformer.metadata(doc);
      trace('Template: %s', transformer.lfTemplate);
      trace('Metadata: %s', metadata);

      // Determine entity name from trading-partner
      const { data: partnerName } = await oada.get({
        path: join(BASE_PATH, masterid, 'name'),
      });
      trace('Trading partner/Entity name: %s', partnerName);

      const lfDoc = await limit(() => createDocument({
        path: '/_Incoming',
        name: `${doc._id}.pdf`,
        template: transformer.lfTemplate,
        metadata: {
          'Entity': partnerName?.toString() ?? 'unknown',
          'Share Mode': 'Shared To Smithfield',
          ...metadata,
        },
      } as const));
      trace('Created Laserfiche document: %s', lfDoc);

      trace(`Fetching ${doc._id}'s PDF`);
      const pdf = await http.get(join(doc._id, '_meta/vdoc/pdf')).buffer();

      trace('Streaming fetched PDF to Laserfiche');
      await limit(() => pipeline(
        Readable.from(pdf),
        streamUpload(lfDoc.LaserficheEntryID, 'pdf', pdf.length),
        new PassThrough()
      ));

      trace('Recording Laserfiche ID to resource meta');
      await oada.put({
        path: join(doc._id, '_meta/services/lf-sync/LaserficheEntryID'),
        data: lfDoc.LaserficheEntryID,
      });

      info(
        `Created Laserfiche entry ${lfDoc.LaserficheEntryID} for document ${doc._id}`
      );
    } catch (e) {
      error('Unexpected error! %s', e);
      throw e;
    }
  };
}
