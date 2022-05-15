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

import got from 'got';
import debug from 'debug';
import { pipeline } from 'node:stream/promises';
// import { PassThrough } from 'node:stream';

import { OADAClient, connect } from '@oada/client';
import { ListWatch, Change } from '@oada/list-lib';
import { createDocument } from './cws/documents.js';
import { streamUpload } from './cws/upload.js';

// Stuff from config
const { token: tokens, domain } = config.get('oada');
// const { toLF } = config.get('syncs');
//

import tree from './tree.js';
import { PassThrough, Readable } from 'node:stream';
import type { Metadata } from './cws/metadata.js';

const trace = debug('lf-sync:trace');
const info = debug('lf-sync:info');
const error = debug('lf-sync:error');

type CoIDocument = {
  effective_date: string;
  expire_date: string;
  producer: {
    name: string;
  };
  insured: {
    name: string;
  };
  holder: {
    name: string;
  };
  policies: {
    [key: string]: CommercialGeneralLiability | AutomotiveLiability;
  };
  signatures: Array<string>;
};

type CommercialGeneralLiability = {
  type: 'Commercial General Liability';
  general_aggregate: string;
};

type AutomotiveLiability = {
  type: 'Automobile Liability';
  combined_single_limit: string;
};

// FIXME: Should be config?
const BASE_PATH = '/bookmarks/trellisfw/trading-partners/masterid-index';
// FIXME: We can't track this beacuse much of the tree is incomplete
// const WATCH_PATH = `$.*.bookmarks.trellisfw.documents.*`,
const WATCH_PATH = '$.bookmarks.trellisfw.documents.cois.*';

// FIXME: Should be config?
const TEMPLATES = new Map(
  Object.entries({
    'application/vnd.trellisfw.coi.accord.1+json': 'SFI - Template 1',
  })
);

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

  // for (const sync of toLF) {
  return new ListWatch({
    conn,
    tree,
    itemsPath: WATCH_PATH,
    name: 'lf-sync-to-lf',
    // resume: true,
    path: `${BASE_PATH}/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e`,
    onAddItem: syncNewDocument(conn),
  });
  // }
}

await Promise.all(tokens.map(async (token) => run(token)));

function syncNewDocument(oada: OADAClient) {
  const http = client.extend({
    headers: {
      Authorization: `Bearer ${oada.getToken()}`,
    },
  });

  // FIXME: What happens if this throws?
  return async function syncNewDocument(data: Change, path: string) {
    // FIXME: Remove when we solve the `itemsPath` issue
    path = `/d4f7b367c7f6aa30841132811bbfe95d3c3a807513ac43d7c8fea41a6688606e${path}`;

    // NOTE: It would be nice if oada/list-lib would give you the `*` values from `itemsPath`
    const parts = path.split('/');
    const masterid = parts[1];
    const docId = parts[parts.length - 1];
    const docType = data._type as string;

    // Determine LF template
    let template = TEMPLATES.get(docType);
    if (!template) {
      error(`Unknown LF template for document type ${docType}`);
      return;
    }
    trace('Template:', template);

    // Compute LF metadata
    let metadata: Metadata;
    switch (docType) {
      case 'application/vnd.trellisfw.coi.accord.1+json':
        metadata = coiMetadata(data as unknown as CoIDocument);
        break;

      default:
        error(`Unrecognized document type ${docType} at ${path}!`);
        return;
    }
    trace('Metadata:', metadata);

    // Determine entity name from trading-partner
    const { data: partnerName } = await oada.get({
      path: `${BASE_PATH}/${masterid}/name`,
    });
    trace('Trading partner/Entity name:', partnerName);

    const lfDoc = await createDocument({
      path: '/../../_Incoming',
      name: `${docId}.pdf`,
      template: 'SFI - Template 1',
      metadata: {
        'Entity': partnerName?.toString() || 'unknown',
        // FIXME: How to know???
        'Share Mode': 'Shared To Smithfield',
        ...metadata,
      },
    } as const);
    trace('Created LF document:', lfDoc);

    // Fetch fetch and upload the PDF document
    trace(`Fetching PDF: ${BASE_PATH}${path}/_meta/vdoc/pdf`);
    try {
      const pdf = await http
        .get(`${BASE_PATH.slice(1)}${path}/_meta/vdoc/pdf`)
        .buffer();
      const upload = streamUpload(lfDoc.LaserficheEntryID, 'pdf', pdf.length);
      await pipeline(Readable.from(pdf), upload, new PassThrough());
      trace('Uploaded to LF');
    } catch (e) {
      // FIXME: oada/list-lib doesn't catch errors?
      error(e);
    }

    // FIXME: We really should do a streaming upload ...
    // const upload = chunkedUpload(body.LaserficheEntryID);
    // await pipeline(pdf, upload);

    // FIXME: Should we store the LF id somewhere? Can one resource be linked multiple places?
    info(
      `Created LF entry ${lfDoc.LaserficheEntryID} for document ${docId} (resources/${data._id})`
    );
  };
}

function coiMetadata(doc: CoIDocument): Metadata {
  // TODO: Should we be summing?
  let policyLimits = Object.values(doc.policies).reduce(
    (values, p) => {
      switch (p.type) {
        case 'Commercial General Liability':
          values.general += +p.general_aggregate;
          break;

        case 'Automobile Liability':
          values.automobile += +p.combined_single_limit;
          break;
      }
      return values;
    },
    { general: 0, automobile: 0 }
  );

  return {
    'Document Type': 'Certificate of Insurance',
    'Document Date': new Date(doc.effective_date).toISOString(),
    'Expiration Date': new Date(doc.expire_date).toISOString(),
    'Insurance Producer': doc.producer.name,
    'Insured Company': doc.insured.name,
    'General Liability': policyLimits.general.toString(),
    'Automotive Liability': policyLimits.automobile.toString(),
    // FIXME: Implement
    'Umbrella Liability': '-1',
    // FIXME: Implement
    'Workers Comp and Employers Liability': '-1',
    // FIXME: Implement
    'Description of Locations/Operations/Vehicles': 'NOT IMPLEMENTED',
    'Certificate Holder': doc.holder.name,
    // FIXME: What is "Signature" for real? Can we easily verify signatures?
    'Signature': doc.signatures.length > 0 ? 'Yes' : 'No',
  };
}
