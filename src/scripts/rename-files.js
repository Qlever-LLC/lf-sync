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

import { config } from '../../dist/config.js';
import { connect } from '@oada/client';
import { doJob } from '@oada/client/jobs';
import csvjson from 'csvjson';
import csvParser from 'csv-parser';
import * as fs from 'node:fs';
import { join } from 'node:path';
import jp from 'jsonpath';
import { retrieveEntry } from '../../dist/cws/entries.js';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'csv-parse';
import readline from 'readline';
import { stringify } from 'csv-stringify';

const { token, domain } = config.get('oada');

setInterval(() => console.log('TICK'), 1000);

const filename = 'LF-Renaming.csv';
const processedFilename = 'LF-Renaming-2025-01-13.csv';

const oada = await connect({ token, domain });
const base = '/bookmarks/trellisfw/trading-partners';

const { data: tradingPartners } = await oada.get({ path: base });

// Define the CSV file path
const csvFilePath = './LF-Renaming-fixed.csv';

/* Script tasks:

1. rename docs (add products/locations)
2. move docs to properly-named, current supplier name
3. perhaps fix date bug in filing workflow
4. add Trellis resource id

*/

// Loop over trading partners
// Loop over doc types
// Loop over documents
// Detect if LF has it
// Detect what the supplier name is
  // Detect if the supplier name matches what we _would_ have named it
// Re-transform the data to get products/locations
// Re-sync the data to LF

// Loop over all master ids
export async function fetch() {
  const rows = [];
  const tpKeys = Object.keys(tradingPartners)
    .filter(key => !key.startsWith('_'))
  for await (const [index, tpKey] of tpKeys.entries()) {
    const mId = tradingPartners[tpKey]._id;
    const { data: tp } = await oada.get({ path: `/${mId}`});
    console.log(`Master id ${index} / ${Object.keys(tpKeys).length}`);
    const documentTypeBase = join('/', mId, '/bookmarks/trellisfw/documents');
    let documentTypes = {};
    try {
      const { data: docTypes } = await oada.get({ path: documentTypeBase });
      documentTypes = docTypes;
    } catch (err) {
      console.log(err);
    }

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
        const { _id } = docs[document];
        const { data: meta } = await oada.get({
          path: join('/', _id, '_meta'),
        });

        const vdocs = jp.query(meta, '$.vdoc.pdf')[0];

        for await (const vdocKey of Object.keys(vdocs || {})) {
           const lfid = jp.query(meta, `$.services['lf-sync']['${vdocKey}'].LaserficheEntryID`)[0];

          if (!lfid) {
            console.log(`LF ID Missing for doc ${_id}`);
            //await relinkDocument(oada, documentBase, document);
          }

          let entry;
          try {
            entry = lfid ? await retrieveEntry(lfid) : undefined;
          } catch (error) {
            // Apparently cws doesn't return a code number in the object persay...
            if (error.code === 'ERR_NON_2XX_3XX_RESPONSE') {
              console.log('Error Occurred');
            } else {
              throw error;
            }
          }

          rows.push({
            'Trellis Document': _id,
            'Trellis Document Type': documentType,
            'Trellis vdoc': vdocs[vdocKey]._id,
            'Trellis Trading Partner ID': mId,
            'Trellis Trading Partner Name': tp.name,
            'LF ID': lfid,
            'LF Name': entry?.Name,
          })
        }
      }
    }

    await writeFile(filename, csvjson.toCSV(rows, {delimiter: ",", wrap: false}));
  }

  await writeFile(filename, csvjson.toCSV(rows, {delimiter: ",", wrap: false}))
}

export async function relinkDocument(conn, documentBase, document) {
  const { data } = await conn.get({ path: documentBase });
  const link = data[document];

  console.log(`Relinking: ${join(documentBase, document)}`);
  await conn.delete({ path: join(documentBase, document) });
  await conn.put({ path: join(documentBase, document), data: link });
}

function dropTrellis(document) {
  delete document._id;
  delete document._rev;
  delete document._type;
  delete document._meta;

  return document;
}

/**
 * Processes a CSV file, escaping commas in values and regenerating the file.
 */
async function fixCSV() {

  // Define the input and output file paths
  const inputFilePath = path.resolve('LF-Renaming.csv');
  const outputFilePath = path.resolve('LF-Renaming-fixed.csv');
  const parser = fs.createReadStream(inputFile).pipe(parse({ relaxQuotes: true, trim: true }));
  const outputStream = fs.createWriteStream(outputFile);
  const stringifier = stringify();

  // Pipe data through the stringifier to handle proper escaping
  parser.on('data', (row) => {
      stringifier.write(row);
  });

  parser.on('end', () => {
      stringifier.end();
      console.log(`Processed CSV has been saved to ${outputFile}`);
  });

  parser.on('error', (error) => {
      console.error('Error processing CSV:', error);
  });

  stringifier.pipe(outputStream);
}


// Define a function to be executed for each entry
async function processEntry(tradingPartner, _id) {
  console.log(`Processing - Trading Partner: ${tradingPartner}, Document ID: ${_id}`);
  await doJob(oada, {
    service: 'lf-sync',
    type: 'sync-doc',
    config: {
      tradingPartner,
      doc: { _id }
    }
  });
}

// Read and parse the CSV file
async function ingestCsv(filePath) {
  const trellisDocs = new Set();
  const rows = [];
  const data = fs.readFileSync(filePath, {encoding: 'utf8'});
  const rowData = csvjson.toObject(data);

  for await (const row of rowData) {
    const {
      'Trellis Trading Partner ID': tradingPartner,
      'Trellis Document': _id,
      'Trellis vdoc': vdoc,
      'Trellis Document Type': type,
      'LF ID': lfId,
      'LF Name': lfName,
      'Trellis Trading Partner Name': tradingPartnerName,
    } = row;

    console.log({
      tradingPartnerName,
      tradingPartner,
      _id,
      lfName,
      lfId,
    })

    // Skip rows that look to have the correct file pattern
    if ((!lfName || lfName.startsWith('['))) {
      rows.push({
        'Trellis Document': _id,
        'Trellis Document Type': type,
        'Trellis vdoc': vdoc,
        'Trellis Trading Partner Name': tradingPartnerName,
        'LF Entry ID': lfId,
        'LF Filename': lfName,
      })
    } else if (!trellisDocs.has(_id)) {
      // Skip rows for which we've already handled the document
      trellisDocs.add(_id);
      try {
        const jobData = await doJob(oada, {
          service: 'lf-sync',
          type: 'sync-doc',
          config: {
            tradingPartner,
            doc: { _id }
          }
        });
        rows.push(...jobDataToRows(jobData, type));
      } catch(err) {
        console.log(err);
      }
    }
  }

  console.log('done iterating');

  await writeFile(processedFilename, csvjson.toCSV(rows, {
    delimiter: ",",
    wrap: false,
    quote: '"'
  }));
}


function fixTpName(name) {
  return name.replaceAll('\t', '');
}

function jobDataToRows(jobData, type) {
  const { config: jobConfig, result } = jobData;
  return Object.entries(result)
    .map(([key, value]) => ({
      'Trellis Document': jobConfig.doc._id,
      'Trellis Document Type': type,
      'Trellis vdoc': key,
      'Trellis Trading Partner Name': jobConfig.tradingPartner,
      'LF Entry ID': value.LaserficheEntryID,
      'LF Filename': value.Name,
    }))

}

// Execute the CSV ingestion
await ingestCsv(csvFilePath);

// Fetch the CSV data by gathering from Trellis
//await fetch();
//fixCsv();
console.log('DONE');
process.exit();