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

import { browse } from '../../dist/cws/folders.js';
import { config } from '../../dist/config.js';
import { connect } from '@oada/client';
import csvjson from 'csvjson';
import { doJob } from '@oada/client/jobs';
import { readFile, writeFile } from 'node:fs/promises';
import { connectToSql } from './rename-files.js';

const { token, domain } = config.get('oada');

setInterval(() => console.log('TICK'), 1000);

const oada = await connect({ token, domain });
const base = '/bookmarks/trellisfw/trading-partners';
const expand = '/bookmarks/trellisfw/trading-partners/_meta/indexings/expand-index';

const { data: tradingPartners } = await oada.get({ path: base });

const { data: tradingPartnersExpand } = await oada.get({ path: expand });
const supplierAlignmentFilename = 'SFSupplierAlignment.csv';
const supplierAlignmentFilenameNew = 'SFSupplierAlignment2025-02-11.csv';
const tps = {
  /*
  'American Foods': [
    'American Foods Group',
    'AmericanFoodsGroup',
  ],
  'Caldic': [
    'Caldic USA, Inc.'
  ],
  'CARGILL - SWEETENERS, STARCHES & TEXTURIZING SOLUTIONS': [
    'CARGILL - SWEETENERS, STARCHES & TEXTURI'
  ],
  'Chemicals, Inc.': [
    'Chemicals Inc.'
  ],
  'JM Swank': [
    'JM Swank, LLC'
  ],
  'LifeWise Ingredients, Inc.': [
    'Lifewise Ingredients LLC'
  ],
  'Maple Leaf': [
    'Maple Leaf Farms, Inc.',

  ],
  'Meat Commodities Inc': [
  */
 'Meat Commodities, Inc.': [],
 'Morton Salt, Inc.': [],
 /*
  'Michael Foods': [
    'Michael Foods, Inc.'
  ],
  'Mizkan': [
    'Mizkan America',
  ],
  'Morton Salt': [
    'Morton Salt, Inc.',
  ],
  'Promotora Comercial Alpro  (Broker - Nor': [
    'Promotora Comercial ALPRO S. de R.L. de'
  ],
  'Saratoga Food Specialties - Eastvale, CA': [
    'Saratoga Food Specialties - Eastval, CA'
  ],
  'Smithfield Foods': [
    'Smithfield Foods CONNECT'
  ],
  'Seaboard Foods LLC  & Dailys  Premium Me': [
    'Seaboard Foods LLC  & Dailys  Premium Meats (A Division of Seaboard Foods Llc)'
  ],
  'Sofina Foods Inc.': [
    'SOFINA FOODS INC-BURLINGTON'
  ],
  'Treehouse Foods': [
    'Treehouse Foods, Inc.'
  ],
  'Trim-Rite Food Corp Carpentersville Il': [
    'Trim-Rite Foods Corp.'
  ],
  'Tyson': [
    'Tyson Food, Inc.',
    'Tyson Foods'
  ],
  */
}


async function gatherLfEntityInfo() {
  const out = {};
  const outfilename = 'entity-alignment.json';
  const obj = {
    /*
    'American Foods': [
      'American Foods Group',
      'AmericanFoodsGroup',
    ],
    'Caldic': [
      'Caldic USA, Inc.'
    ],
    'CARGILL - SWEETENERS, STARCHES & TEXTURIZING SOLUTIONS': [
      'CARGILL - SWEETENERS, STARCHES & TEXTURI'
    ],
    'Chemicals, Inc.': [
      'Chemicals Inc.'
    ],
    'JM Swank': [
      'JM Swank, LLC'
    ],
    'LifeWise Ingredients, Inc.': [
      'Lifewise Ingredients LLC'
    ],
    'Maple Leaf': [
      'Maple Leaf Farms, Inc.',

    ],
    'Meat Commodities Inc': [
    */
   'Meat Commodities, Inc.': [],
   'Morton Salt, Inc.': [],
   'Schreiber Foods\t Inc. (General Dashboard)': [],
   /*
    'Michael Foods': [
      'Michael Foods, Inc.'
    ],
    'Mizkan': [
      'Mizkan America',
    ],
    'Morton Salt': [
      'Morton Salt, Inc.',
    ],
    'Promotora Comercial Alpro  (Broker - Nor': [
      'Promotora Comercial ALPRO S. de R.L. de'
    ],
    'Saratoga Food Specialties - Eastvale, CA': [
      'Saratoga Food Specialties - Eastval, CA'
    ],
    'Smithfield Foods': [
      'Smithfield Foods CONNECT'
    ],
    'Seaboard Foods LLC  & Dailys  Premium Me': [
      'Seaboard Foods LLC  & Dailys  Premium Meats (A Division of Seaboard Foods Llc)'
    ],
    'Sofina Foods Inc.': [
      'SOFINA FOODS INC-BURLINGTON'
    ],
    'Treehouse Foods': [
      'Treehouse Foods, Inc.'
    ],
    'Trim-Rite Food Corp Carpentersville Il': [
      'Trim-Rite Foods Corp.'
    ],
    'Tyson': [
      'Tyson Food, Inc.',
      'Tyson Foods'
    ],
    */
  }

  const allEntities = [
    ...Object.keys(obj),
    ...Object.values(obj).flat(1)
  ]

  for await (const name of allEntities) {
    /*const job = await doJob(oada, {
      service: 'trellis-data-manager',
      type: 'trading-partners-query',
      config: {
        element: {
          name,
        }
      }
    });
    */

    const count = await getDocCount(name);

    out[name] = {
      //job,
      ...count
    }
  }

  // For each listed trading partner:
  // 1. Run a query to see if there are any hits from our trellis-data-manager
  // 2. Figure out how many docs are in LF for each of thsoe TPs
  // 3. Need to understand WHY they were created in the first place and how to alleviate
  //

  await writeFile(outfilename, JSON.stringify(out))
}

async function getDocCount(entity) {
  const count = {};
  const modes = await browse(`/trellis/trading-partners/${entity}`);
  for await (const { Name: mode } of modes) {
    const docTypes = await browse(`/trellis/trading-partners/${entity}/${mode}`);
    for await (const { Name : type } of docTypes) {
      const docs = await browse(`/trellis/trading-partners/${entity}/${mode}/${type}`);
      count[mode] ||= 0;
      count[mode] += docs.length;
    }
  }

  return count;
}

export async function fillOutSupplierCsv() {
  const sqlConn = await connectToSql();
  const data = await readFile(supplierAlignmentFilename);
  const rowData = csvjson.toObject(data);
  const outRows = [];

  for await (const row of rowData) {
    const results = sqlConn.query`SELECT * FROM tradingPartners WHERE name = ${row['Trading Partner']}`

    console.log(results);

    outRows.push({
      ...row,
      'Count In Trellis': results.length,
    })
  }

  await writeFile(supplierAlignmentFilenameNew, csvjson.toCSV(outRows))


}

export async function moveLfDocs(sqlConn, supplierFrom) {
  const fromDocs = await sqlConn.query`SELECT * FROM docs WHERE tradingPartnerId = ${supplierFrom}`;

  for await (const _id of fromDocs) {
    const job = await doJob(oada, {
      service: 'lf-sync',
      type: 'sync-doc',
      config: {
        tradingPartner: supplierFrom,
        doc: { _id }
      }
    })
  }
}

async function moveSupplierDocs(sqlConn) {

  for await (const [to, fromArray] of Object.entries(tps)) {
    console.log(`Moving from ${fromArray} to ${to}`);
    for await (const from of fromArray) {
      const fromTp = await sqlConn.query`SELECT * FROM tradingPartners WHERE name = ${from}`;

      if (!fromTp) {
        console.log('No trading partner found');
        throw new Error('No trading partner found');
      }

      // Rename Trellis TP
      /*
      await doJob(oada, {
        service: 'trellis-data-manager',
        type: 'trading-partners-update',
        config: {
          element: {
            masterid: fromTp.id,
            name: to,
          }

        }
      })
      */
      await moveLfDocs(sqlConn, from);
    }
  }
}

async function getTrellisDocCount(tpName) {
  let count = 0;
  const tp = Object.values(expand).find(t => t.name === tpName);
  if (!tp) return count;

  const docTypesPath = `/${tp.bookmarks}/trellisfw/documents/`;
  const { data: docTypes } = await oada.get({
    path: `${docTypesPath}`
  })

  for await(const docType of Object.keys(docTypes).filter(key => !key.startsWith('_'))) {
    const { data: docs } = await oada.get({
      path: `${docTypesPath}/${docType}`
    })
    count += (Object.keys(docs || {}).filter(key => !key.startsWith('_'))).length
  }

  return count;
}

// Gather the relevant trading-partner information
//await gatherLfEntityInfo();

await fillOutSupplierCsv();

console.log('DONE');
process.exit();