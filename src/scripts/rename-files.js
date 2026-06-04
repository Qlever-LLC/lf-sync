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

//import csvParser from 'csv-parser';
import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { join } from "node:path";
import { connect } from "@oada/client";
import { doJob } from "@oada/client/jobs";
import { parse } from "csv-parse";
//import readline from 'readline';
import { stringify } from "csv-stringify";
import csvjson from "csvjson";
import jp from "jsonpath";
import mysql from "mysql2/promise";
import { config } from "../../dist/config.js";
import { renameEntry, retrieveEntry } from "../../dist/cws/entries.js";
//import { createObjectCsvWriter } from 'csv-writer';
import { filingWorkflowFromEntry } from "../../dist/utils.js";

const { token, domain } = config.get("oada");
const { database, host, user, password } = config.get("local-mysql");

setInterval(() => console.log("TICK"), 1000);

const filename = "LF-Renaming.csv";
const processedFilename = "LF-Renaming-2025-01-13.csv";
const outputCsvPath = "LF-Renaming-2025-02-15.csv";

const oada = await connect({ token, domain });
const base = "/bookmarks/trellisfw/trading-partners";

const { data: tradingPartners } = await oada.get({ path: base });

// Define the CSV file path
const csvFilePath = "LF-Renaming-fixed.csv";

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
  const tpKeys = Object.keys(tradingPartners).filter(
    (key) => !key.startsWith("_"),
  );
  for await (const [index, tpKey] of tpKeys.entries()) {
    const mId = tradingPartners[tpKey]._id;
    const { data: tp } = await oada.get({ path: `/${mId}` });
    console.log(`Master id ${index} / ${Object.keys(tpKeys).length}`);
    const documentTypeBase = join("/", mId, "/bookmarks/trellisfw/documents");
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
        documentType === "name" ||
        documentType === "code" ||
        documentType === "documents"
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
          path: join("/", _id, "_meta"),
        });

        const vdocs = jp.query(meta, "$.vdoc.pdf")[0];

        for await (const vdocKey of Object.keys(vdocs || {})) {
          const lfid = jp.query(
            meta,
            `$.services['lf-sync']['${vdocKey}'].LaserficheEntryID`,
          )[0];

          if (!lfid) {
            console.log(`LF ID Missing for doc ${_id}`);
            //await relinkDocument(oada, documentBase, document);
          }

          let entry;
          try {
            entry = lfid ? await retrieveEntry(lfid) : undefined;
          } catch (error) {
            // Apparently cws doesn't return a code number in the object persay...
            if (error.code === "ERR_NON_2XX_3XX_RESPONSE") {
              console.log("Error Occurred");
            } else {
              throw error;
            }
          }

          rows.push({
            "Trellis Document": _id,
            "Trellis Document Type": documentType,
            "Trellis vdoc": vdocs[vdocKey]._id,
            "Trellis Trading Partner ID": mId,
            "Trellis Trading Partner Name": tp.name,
            "LF ID": lfid,
            "LF Name": entry?.Name,
          });
        }
      }
    }

    await writeFile(
      filename,
      csvjson.toCSV(rows, { delimiter: ",", wrap: false }),
    );
  }

  await writeFile(
    filename,
    csvjson.toCSV(rows, { delimiter: ",", wrap: false }),
  );
}

export async function connectToSql() {
  return mysql.createConnection({
    host,
    user,
    password,
    database,
  });
}

export async function populateLocalDb() {
  const conn = await connectToSql();
  const tpKeys = Object.keys(tradingPartners).filter(
    (key) => !key.startsWith("_"),
  );
  for await (const [index, tpKey] of tpKeys.entries()) {
    const mId = tradingPartners[tpKey]._id;
    const { data: tp } = await oada.get({ path: `/${mId}` });
    console.log(`Master id ${index} / ${Object.keys(tpKeys).length}`);

    const insertTp = `
      INSERT INTO tradingPartners (id, name, externalIds, tpKey)
      VALUES (?, ?, ?, ?)
    `;

    const tpValues = [
      mId, // id
      tp.name, // name
      JSON.stringify(tp.externalIds), // externalIds
      tpKey, // tpKey
    ];

    try {
      await conn.query(insertTp, tpValues);
    } catch (err) {
      console.log(err);
      throw err;
    }

    const documentTypeBase = join("/", mId, "/bookmarks/trellisfw/documents");
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
        documentType === "name" ||
        documentType === "code" ||
        documentType === "documents"
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
          path: join("/", _id, "_meta"),
        });

        const vdocs = jp.query(meta, "$.vdoc.pdf")[0];

        for await (const vdocKey of Object.keys(vdocs || {})) {
          const lfid = jp.query(
            meta,
            `$.services['lf-sync']['${vdocKey}'].LaserficheEntryID`,
          )[0];

          if (!lfid) {
            console.log(`LF ID Missing for doc ${_id}`);
            //await relinkDocument(oada, documentBase, document);
          }

          let entry;
          try {
            entry = lfid ? await retrieveEntry(lfid) : undefined;
          } catch (error) {
            // Apparently cws doesn't return a code number in the object persay...
            if (error.code === "ERR_NON_2XX_3XX_RESPONSE") {
              console.log("Error Occurred");
            } else {
              throw error;
            }
          }

          const insertQuery = `
            INSERT INTO docs (pdfId, tradingPartnerId, docType, lfEntryId, trellisDocKey, trellisPdfKey, trellisDocId)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `;

          const values = [
            vdocs[vdocKey]._id, // id
            mId, // tradingPartnerId
            documentType, // docType
            lfid, // lfEntryId
            document, // trellisDocKey, //
            vdocKey, // trellisPdfKey
            _id, // trellisDocResource
          ];

          try {
            await conn.query(insertQuery, values);
          } catch (err) {
            console.log(err);
            throw err;
          }
        }
      }
    }

    //await writeFile(filename, csvjson.toCSV(rows, {delimiter: ",", wrap: false}));
  }

  //await writeFile(filename, csvjson.toCSV(rows, {delimiter: ",", wrap: false}))
}

const sql = String.raw;

export async function addLfNameToLocalDb() {
  const conn = await connectToSql();
  const rows = await conn.query(
    sql`SELECT * FROM docs WHERE trellisPdfKey IS NOT NULL AND trellisDocId IS NOT NULL`,
  );

  for await (const row of rows[0]) {
    try {
      const { data: lfName } = await oada.get({
        path: `/${row.trellisDocId}/_meta/services/lf-sync/${row.trellisPdfKey}/Name`,
      });
      await conn.query(sql`UPDATE docs SET lfFilename = ? WHERE id = ?`, [
        lfName,
        row.id,
      ]);
    } catch (err) {
      console.log("Couldnt find lf name for entry");
    }
  }
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
  const inputFilePath = path.resolve("LF-Renaming.csv");
  const outputFilePath = path.resolve("LF-Renaming-fixed.csv");
  const parser = fs
    .createReadStream(inputFile)
    .pipe(parse({ relaxQuotes: true, trim: true }));
  const outputStream = fs.createWriteStream(outputFile);
  const stringifier = stringify();

  // Pipe data through the stringifier to handle proper escaping
  parser.on("data", (row) => {
    stringifier.write(row);
  });

  parser.on("end", () => {
    stringifier.end();
    console.log(`Processed CSV has been saved to ${outputFile}`);
  });

  parser.on("error", (error) => {
    console.error("Error processing CSV:", error);
  });

  stringifier.pipe(outputStream);
}

// Define a function to be executed for each entry
async function processEntry(tradingPartner, _id) {
  await doJob(oada, {
    service: "lf-sync",
    type: "sync-doc",
    config: {
      tradingPartner,
      doc: { _id },
    },
  });
}

// Read and parse the CSV file
async function ingestCsv(filePath) {
  const trellisDocs = new Set();
  const outputRows = [];
  const data = fs.readFileSync(filePath, { encoding: "utf8" });
  const rowData = csvjson.toObject(data);

  for await (const row of rowData) {
    const {
      "Trellis Trading Partner ID": tradingPartner,
      "Trellis Document": _id,
      "Trellis vdoc": vdoc,
      "Trellis Document Type": type,
      "LF ID": lfId,
      "LF Name": lfName,
      "Trellis Trading Partner Name": tradingPartnerName,
    } = row;

    // Skip rows that look to have the correct file pattern
    if (!lfName || lfName.startsWith("[")) {
      console.log("skipping doc", _id, { lfName });
      outputRows.push({
        "Trellis Document": _id,
        "Trellis Document Type": type,
        "Trellis vdoc": vdoc,
        "Trellis Trading Partner Name": tradingPartnerName,
        "LF Entry ID": lfId,
        "LF Filename": lfName,
        "Old LF Filename": lfName,
      });
    } else if (!trellisDocs.has(_id)) {
      // Once a document is handled, all of its vdocs are handled. Skip any future rows that
      // use that doc _id (the csv has one row per VDOC; doc _ids are not unique)
      trellisDocs.add(_id);
      try {
        console.log(
          `Processing - Trading Partner: ${tradingPartner}, Document ID: ${_id}`,
        );
        const jobData = await doJob(oada, {
          service: "lf-sync",
          type: "sync-doc",
          config: {
            tradingPartner,
            doc: { _id },
          },
        });
        outputRows.push(...jobDataToRows(jobData, type));
      } catch (err) {
        console.log(err);
      }
    }
  }

  await writeFile(
    processedFilename,
    csvjson.toCSV(outputRows, {
      delimiter: ",",
      wrap: false,
      quote: '"',
    }),
  );
}

function fixTpName(name) {
  return name.replaceAll("\t", "");
}

function jobDataToRows(jobData, type, tradingPartnerName) {
  const { config: jobConfig, result } = jobData;
  return Object.values(result).map((value) => ({
    "Trellis Document": jobConfig.doc._id,
    "Trellis Document Type": type,
    "Trellis vdoc": value._id,
    "Trellis Trading Partner Name": tradingPartnerName,
    "LF Entry ID": value.LaserficheEntryID,
    "LF Filename": value.Name,
  }));
}

async function fixupCsv(inputFilename, outputFilename) {
  const outputRows = [];
  const data = fs.readFileSync(inputFilename, { encoding: "utf8" });
  const rowData = csvjson.toObject(data);

  let i = 0;
  let j = 0;
  for await (const row of rowData) {
    console.log(`${i++}/${rowData.length} j=${j}`);
    if (j++ === 1000) {
      await writeFile(
        outputFilename.replace("csv", "json"),
        JSON.stringify(outputRows),
      );
      j = 0;
    }

    row["Trellis Trading Partner Name"] = row[
      "Trellis Trading Partner Name"
    ].replace("\t", " ");

    const vdocId = row["Trellis vdoc"];

    const { data: meta } = await oada.get({
      path: `/${row["Trellis Document"]}/_meta`,
    });

    const vdocs = jp.query(meta, "$.vdoc.pdf")[0];
    const vdoc = Object.entries(vdocs).find(([, v]) => v._id === vdocId);

    if (vdoc) {
      let Name;
      try {
        const entry = row["LF ID"]
          ? await retrieveEntry(Number.parseInt(row["LF ID"], 10))
          : {};
        Name = entry?.Name;
      } catch (err) {
        console.log(err);
      }

      //const Name = jp.query(meta, `$.services['lf-sync']['${vdoc[0]}'].Name`)[0];

      outputRows.push({
        ...row,
        "Renamed LF Filename": Name,
      });
    } else {
      console.log("WHAT?");
    }
  }

  await writeFile(
    outputFilename,
    csvjson.toCSV(outputRows, {
      delimiter: ",",
      wrap: false,
      quote: '"',
    }),
  );
}

async function generateRenamesCsv(inputFilename, outputFilename) {
  const sqlConn = await connectToSql();
  const outputRows = [];
  const data = fs.readFileSync(inputFilename, { encoding: "utf8" });
  const rowData = csvjson
    .toObject(data)
    .filter((row) => row["[].LF Name"])
    .filter((row) => row["[].LF ID"]);

  let i = 0;
  let j = 0;
  for await (const row of rowData) {
    console.log(`${i++}/${rowData.length} j=${j}`);
    if (j++ === 1000) {
      await writeFile(
        outputFilename.replace("csv", "json"),
        JSON.stringify(outputRows),
      );
      j = 0;
    }

    const result = await sqlConn.query(
      sql`SELECT * FROM docs WHERE lfEntryId = ?`,
      [row["[].LF ID"]],
    );
    if (result.length === 0) continue;
    if (!result[0][0].tradingPartnerId) {
      console.log("Result missing tradingPartnerId");
      continue;
    }

    const tpRes = await sqlConn.query(
      sql`SELECT * FROM tradingPartners WHERE id = ?`,
      [result[0][0].tradingPartnerId],
    );
    if (tpRes.length === 0) continue;
    if (!tpRes[0][0].name) {
      console.log("Result missing name");
      continue;
    }

    if (!result[0][0].lfFilename) continue;

    outputRows.push({
      "Trading Partner Name": tpRes[0][0].name,
      "Document Type": result[0][0].docType,
      "Original LF Filename": row["[].LF Name"],
      "Renamed LF Filename": result[0][0].lfFilename,
    });
  }

  await writeFile(
    outputFilename,
    csvjson.toCSV(outputRows, {
      delimiter: ",",
      wrap: false,
      quote: '"',
    }),
  );
}

export async function fixBadFilenames() {
  const sqlConn = await connectToSql();
  const query = `SELECT d.*
    FROM docs d
    JOIN (
        SELECT lfFilename, tradingPartnerId, docType
        FROM docs
        WHERE lfFilename IS NOT NULL
        AND tradingPartnerId IS NOT NULL
        AND docType <> 'tickets'
        GROUP BY lfFilename, tradingPartnerId, docType
        HAVING COUNT(*) > 1
    ) dup ON d.lfFilename = dup.lfFilename AND d.tradingPartnerId = dup.tradingPartnerId AND d.docType = dup.docType;`;
  const results = await sqlConn.query(query);

  for await (const row of results[0]) {
    // 1. Fetch the entryId over in CWS
    const entry = await retrieveEntry(row.lfEntryId);

    let lfFilename = entry.Name;
    if (!entry.Name.includes("EFF") && !entry.Name.includes("EXP")) {
      const res = filingWorkflowFromEntry(entry);
      await renameEntry(entry.EntryId, res.path, res.filename);
      const renamedEntry = await retrieveEntry(row.lfEntryId);
      lfFilename = renamedEntry.Name;
    }

    try {
      await oada.put({
        path: `/${row.trellisDocId}/_meta/services/lf-sync/${row.trellisPdfKey}/Name`,
        data: lfFilename,
      });
    } catch (err) {
      console.log(err);
      console.log("failed for some reason?");
    }

    await sqlConn.query(sql`UPDATE docs SET lfFilename = ? WHERE id = ?`, [
      lfFilename,
      row.id,
    ]);
  }

  /*
  const thing = await doJob(oada, {
    service: 'lf-sync',
    type: 'sync-doc',
    config: {
      doc: { _id: 'resources/2iD76Gv5p0ovZsIspxSg9ZeaIwP' },
      tradingPartner: 'resources/1x3HKWVFX8JKcjw3aZGO3h8lq2Q',
    }
  })
    */
}

export async function fixBadFilenamesMove() {
  const sqlConn = await connectToSql();
  const results = await sqlConn.query(
    `SELECT * FROM docs WHERE DATE(updated_at) = '2025-02-14'`,
  );

  for await (const row of results[0]) {
    // 1. Fetch the entryId over in CWS
    const entry = await retrieveEntry(row.lfEntryId);
    const res = filingWorkflowFromEntry(entry);
    await renameEntry(entry.EntryId, res.path, res.filename);
  }
}

// fix the LF-Renaming csv
//await fixupCsv(csvFilePath, outputCsvPath);

// Execute the CSV ingestion
//await ingestCsv(csvFilePath);

// Fetch the CSV data by gathering from Trellis
//await fetch();

// Fix the CSV fetched
//fixCsv();

//await populateLocalDb();
// Somehow didn't add lfFilename the first go round...
//await addLfNameToLocalDb();

//await fixBadFilenames();
// fixBadFilenames didn't break anything itself, but a change to filingWorkflow caused
// filepaths to omit 'Share Mode', so this reprocessed the affected ones
//await fixBadFilenamesMove();

//await generateRenamesCsv(filename, outputCsvPath);
console.log("DONE");
process.exit();
