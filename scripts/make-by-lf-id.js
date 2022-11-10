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

import config from '../dist/config.js';

import { connect } from '@oada/client';

const { token: tokens, domain } = config.get('oada');
const basePath = `/bookmarks/trellisfw/trading-partners/masterid-index`;

function removeReserved(keys) {
  return keys.filter((key) => key.charAt(0) !== '_');
}

setInterval(() => console.log('ping'), 3000);

const oada = await connect({
  token: tokens[0],
  domain,
});

const { data: tps } = await oada.get({
  path: basePath,
});

const tpKeys = removeReserved(Object.keys(tps));

for await (const tp of tpKeys) {
  const documentTypes = await oada
    .get({
      path: `${basePath}/${tp}/bookmarks/trellisfw/documents`,
    })
    .then((r) => r.data)
    .catch((error) => {
      if (error.status !== 404) throw error;
      return {};
    });

  const documentTypeKeys = removeReserved(Object.keys(documentTypes));

  for await (const documentType of documentTypeKeys) {
    if (documentType === 'code' || documentType === 'name') {
      console.log(
        'FOUND bad doctype',
        `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}`
      );
      await oada.delete({
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}`,
      });
      continue;
    }

    const docs = await oada
      .get({
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}`,
      })
      .then((r) => r.data)
      .catch((error) => {
        if (error.status !== 404) throw error;
        return {};
      });

    const documentKeys = removeReserved(Object.keys(docs));

    for await (const documentKey of documentKeys) {
      // Now, edit the vdoc structure and write the content to the by-lf-id
      console.log('Found:', {
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}`,
      });
      const document = await oada
        .get({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}`,
        })
        .then((r) => r.data)
        .catch((error) => {
          if (error.status !== 404) throw error;
          return {};
        });

      const { data: meta } = await oada.get({
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta`,
      });

      if (meta?.vdoc?.pdf?._id) {
        // Old style vdoc pdf that isn't hash indexed
        console.log(
          'FOUND AN OLD VDOC PDF',
          `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta`,
          meta.vdoc.pdf
        );
        await oada.delete({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta/vdoc`,
        });
        const newObject = meta?.vdoc?.pdf;
        delete newObject._id;
        await oada.put({
          path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta/vdoc/pdf`,
          data: newObject,
        });
      }

      /*
        Const hashes = removeReserved(Object.keys(meta?.vdoc?.pdf || {}));
        for await (const hash of hashes) {

          let lfid = meta?.services?.['lf-sync']?.LaserficheEntryID?.[hash];

          if (lfid) {
            let lfmeta= await getMetadata(lfid);
            let currentFields = lfmeta.LaserficheFieldList.reduce(
              (o, f) =>
                has(f, 'Value') && f.Value !== '' ? { ...o, [f.Name]: f.Value } : o,
              {}
            );


            let data = {
              LaserficheEntryID: lfid,
              data: currentFields,
              lastSync: new Date().toISOString()
            }

            console.log('Fix _meta/services/lf-sync', JSON.stringify({
              path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`,
              data: {
                services: {
                  'lf-sync': {
                    [hash]: data
                  }
                }
              },
              contentType: meta._type
            }, null, 2))

            await oada.put({
              path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${docType}/${docKey}/_meta`,
              data: {
                'services': {
                  'lf-sync': {
                    [hash]: data
                  }
                }
              },
              contentType: meta._type
            })

            await oada.put({
              path: `/bookmarks/services/lf-sync/by-lf-id`,
              data: {
                [lfid]: { _id: doc._id }
              }
            })

            console.log('Create by-lf-id', JSON.stringify({
              path: `/bookmarks/services/lf-sync/by-lf-id`,
              data: {
                [lfid]: { _id: doc._id }
              }
            }, null, 2))
          }
        }
        */
      console.log(
        'Delete LaserficheEntryID',
        JSON.stringify(
          {
            path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta/services/lf-sync/LaserficheEntryID`,
          },
          undefined,
          2
        )
      );
      await oada.delete({
        path: `${basePath}/${tp}/bookmarks/trellisfw/documents/${documentType}/${documentKey}/_meta/services/lf-sync/LaserficheEntryID`,
      });
    }
  }
}
