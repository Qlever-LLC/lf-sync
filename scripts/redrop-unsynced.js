/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console */

import { config } from '../dist/config.js';

import { join } from 'node:path';

import { connect } from '@oada/client';

const { token: tokens, domain } = config.get('oada');

setInterval(() => console.log('TICK'), 1000);

const oada = await connect({ token: tokens[0] || '', domain });
const base = '/bookmarks/trellisfw/trading-partners/masterid-index';

const { data: masterIds } = await oada.get({ path: base });
dropTrellis(masterIds);

delete masterIds[''];
delete masterIds.bookmarks;
delete masterIds.smithfield;

// Loop over all master ids
for await (const [index, mId] of Object.keys(masterIds).entries()) {
  console.log(`Master id ${index} / ${Object.keys(masterIds).length}`);
  const documentTypeBase = join(base, mId, '/bookmarks/trellisfw/documents');
  const { data: documentTypes } = await oada.get({ path: documentTypeBase });
  dropTrellis(documentTypes);

  // Loop over each master id's document types
  for await (const documentType of Object.keys(documentTypes)) {
    // Known mistake keys
    if (
      documentType === 'name' ||
      documentType === 'code' ||
      documentType === 'documents'
    ) {
      continue;
    }

    const documentBase = join(documentTypeBase, documentType);
    const { data: docs } = await oada.get({ path: documentBase });
    dropTrellis(docs);

    // Loop over each master id's document types documents
    for await (const document of Object.keys(docs)) {
      const pdfBase = join(documentBase, document, '_meta/vdoc/pdf');
      const { data: pdfs } = await oada.get({ path: pdfBase });
      dropTrellis(pdfs);

      // Loop over each pdf
      for await (const pdf of Object.keys(pdfs)) {
        try {
          await oada.get({
            path: join(
              documentBase,
              document,
              '_meta/services/lf-sync/LaserficheEntryID',
              pdf,
            ),
          });
        } catch (error) {
          if (Number(error.code) === 404) {
            console.log(`Relinking path: ${join(documentBase, document)}`);

            console.log(docs[document]);
            await oada.delete({ path: join(documentBase, document) });
            await oada.put({
              path: join(documentBase, document),
              data: docs[document],
            });
            break;
          } else {
            throw error;
          }
        }
      }
    }
  }
}

function dropTrellis(document) {
  delete document._id;
  delete document._rev;
  delete document._type;
  delete document._meta;

  return document;
}

console.log(docTypeCount);
console.log('PRINT REPORT');

let totalPushed = 0;
let totalNotPushed = 0;

for (const [documentType, stats] of docTypeCount) {
  totalPushed += stats.pushed;
  totalNotPushed += stats.notPushed;

  console.log(
    `${documentType}: ${stats.pushed} / ${stats.pushed + stats.notPushed} (${(
      (stats.pushed * 100) /
      (stats.pushed + stats.notPushed)
    ).toFixed(2)} %)`,
  );
}

console.log();
console.log(
  `TOTAL: ${totalPushed} / ${totalPushed + totalNotPushed} (${(
    (totalPushed * 100) /
    (totalPushed + totalNotPushed)
  ).toFixed(2)} %)`,
);
