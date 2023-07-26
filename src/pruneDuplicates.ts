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

import {
  FolderEntry,
  browse,
} from './cws/index.js';

//import { connect } from '@oada/client';
//import { config } from './config.js';
//const { token, domain } = config.get('oada');

async function dedupeInLF() {
  //const oada = await connect({domain, token: token[0]!});
  let path = `/trellis/trading-partners`;
  // @ts-expect-error doesn't like something about the string?
  const tps = (await browse(path)) as unknown as FolderEntry[];
  for await (const tp of tps) {
  // @ts-expect-error doesn't like something about the string?
    const share = (await browse(`${path}/${tp.Name}`)) as unknown as FolderEntry[];
    for await (const mode of share) {
  // @ts-expect-error doesn't like something about the string?
      const docTypes = (await browse(`${path}/${tp.Name}/${mode.Name}`)) as unknown as FolderEntry[];
      for await (const docType of docTypes) {
        if (docType.Name === 'Zendesk Tickets') continue;
  // @ts-expect-error doesn't like something about the string?
        const files = (await browse(`${path}/${tp.Name}/${mode.Name}/${docType.Name}`)) as unknown as FolderEntry[];
        try {
          //for await (const file of files) {
          //const pattern = /([0-9]*)/;
          //const stuff = pattern.test(file.Name);
        } catch(err) {
          console.log(err);
          continue;
        }
      }
    }
  }
}

await dedupeInLF();

/*
async function dedupeInTrellis() {
  const oada = await connect({domain, token: token[0]!});
  const { data: tps } = (await oada.get({
    path: `/bookmarks/trellisfw/trading-partners`
  })) as {data: Record<string, {_id: string}> };
  for await (const { _id: masterid } of Object.values(tps)) {
    let { data: docTypes } = (await oada.get({
      path: `/${masterid}/bookmarks/trellisfw/documents`
    })) as {data: any};
    docTypes = Object.keys(docTypes).filter((key) => !key.startsWith('_'));
    for await (const docType of docTypes) {
      let { data: docs } = (await oada.get({
        path: `/${masterid}/bookmarks/trellisfw/documents/${docType}`,
      })) as {data: any};
      docs = Object.keys(docs).filter((key) => !key.startsWith('_'));
      for await (const docName of docs) {
        let { data: meta } = await oada.get({
          path: `/${masterid}/bookmarks/trellisfw/documents/${docType}/${docName}/_meta`,
        })
        console.log(meta);
        try {
          // Do stuff on each doc
        } catch(err) {
          console.log(err);
          continue;
        }
      }
    }
  }
}
*/

process.exit();