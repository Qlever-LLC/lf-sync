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

//import { doJob } from '@oada/client/jobs';
import { readFile, writeFile } from "node:fs/promises";
import { connect } from "@oada/client";
import csvjson from "csvjson";
import mysql from "mysql2/promise";
import { config } from "../../dist/config.js";
import { renameEntry, retrieveEntry } from "../../dist/cws/entries.js";
import { browse } from "../../dist/cws/folders.js";
import { setMetadata } from "../../dist/cws/metadata.js";
import { filingWorkflowFromEntry } from "../../dist/utils.js";

const { token, domain } = config.get("oada");
const { database, host, user, password } = config.get("local-mysql");

setInterval(() => console.log("TICK"), 1000);

const oada = await connect({ token, domain });
const base = "/bookmarks/trellisfw/trading-partners";
const expand =
  "/bookmarks/trellisfw/trading-partners/_meta/indexings/expand-index";

const { data: tradingPartners } = await oada.get({ path: base });

const { data: tradingPartnersExpand } = await oada.get({ path: expand });
const supplierAlignmentFilename = "SFSupplierAlignment.csv";
const supplierAlignmentFilenameNew = "SFSupplierAlignment2025-02-14.csv";
const tps = {
  "American Foods Group": [
    //'American Foods', // Are we sure about this one?
    "AmericanFoodsGroup",
  ],
  "Caldic USA, Inc.": ["Caldic"],
  "CARGILL - SWEETENERS, STARCHES & TEXTURIZING SOLUTIONS": [
    "CARGILL - SWEETENERS, STARCHES & TEXTURI",
  ],
  "Chemicals, Inc.": ["Chemicals Inc."],
  "JM Swank, LLC": ["JM Swank"],
  "LifeWise Ingredients, Inc.": ["Lifewise Ingredients LLC"],
  "Maple Leaf Farms, Inc.": [
    //'Maple Leaf' // ask about this one
  ],
  "Meat Commodities, Inc.": ["Meat Commodities, Inc", "Meat Commodities Inc"],
  "Michael Foods, Inc.": ["Michael Foods"],
  "Mizkan America": ["Mizkan"],
  "Morton Salt, Inc.": ["Morton Salt"],
  "Promotora Comercial Alpro (Broker - Norson)": [
    "Promotora Comercial Alpro  (Broker - Nor",
    // Confirm these with Chris. Is it helpful to have foreign ones separate?
    //'Promotora Comercial ALPRO S. de R.L. de'
  ],
  "Saratoga Food Specialties - Eastvale, CA": [
    "Saratoga Food Specialties - Eastval, CA",
  ],
  "Schreiber Foods, Inc.": [
    "Schreiber Foods, Inc. (General Dashboard)",
    "Schreiber Foods, Inc. (General Dashboard",
  ],
  //'Smithfield Foods': [
  //  'Smithfield Foods CONNECT'
  //],
  "Seaboard Foods LLC & Dailys Premium Meats": [
    "Seaboard Foods LLC  & Dailys  Premium Me",
    "Seaboard Foods LLC  & Dailys  Premium Meats (A Division of Seaboard Foods Llc)",
  ],
  "Sofina Foods Inc.": ["SOFINA FOODS INC-BURLINGTON"],
  "Treehouse Foods, Inc.": ["Treehouse Foods"],
  "Trim-Rite Foods Corp.": ["Trim-Rite Food Corp Carpentersville Il"],
  "Tyson Foods, Inc.": [
    //'Tyson Food, Inc.',
    //'Tyson',
    "Tyson Foods",
  ],
};

export async function connectToSql() {
  return mysql.createConnection({
    host,
    user,
    password,
    database,
  });
}

async function gatherLfEntityInfo() {
  const sqlConn = await connectToSql();
  /*
  const out = [];
  const outfilename = 'entity-alignment.csv';
  */

  const allEntities = [
    ...new Set([...Object.keys(tps), ...Object.values(tps).flat(1)]),
  ];

  for await (const name of allEntities) {
    await getDocCount(name, sqlConn);
    /*
    out.push({
      ...count
    })
      */
  }

  //  await writeFile(outfilename, csvjson.toCSV(out))
}

async function getDocCount(entity, sqlConn) {
  console.log("Retrieving entity", entity);
  const tpData = {};
  let modes = [];
  try {
    modes = await browse(`/trellis/trading-partners/${entity}`);
  } catch (error) {
    console.log(error);
    console.log("No TP");
  }

  for await (const { Name: mode } of modes) {
    const docTypes = await browse(
      `/trellis/trading-partners/${entity}/${mode}`,
    );
    for await (const { Name: type } of docTypes) {
      const docs = await browse(
        `/trellis/trading-partners/${entity}/${mode}/${type}`,
      );
      if (type === "Zendesk Ticket") {
        for await (const { Name: month, Path: p } of docs) {
          // Before handling zendesk tickets we created a bunch of bad table entries.
          // This query cleaned them up before adding the correct table entries. If we
          // rerun this for some reason, we won't need to delete anything.
          //sqlConn.query(`DELETE FROM lfDocs WHERE path = ?`, [p])
          const tickets = await browse(
            `/trellis/trading-partners/${entity}/${mode}/${type}/${month}`,
          );
          for await (const { Name: ticketId } of tickets) {
            const ticketDocs = await browse(
              `/trellis/trading-partners/${entity}/${mode}/${type}/${month}/${ticketId}`,
            );
            for await (const { EntryId, Path } of ticketDocs) {
              const insertQuery = `INSERT INTO lfDocs
                (lfEntryId, path, tradingPartnerId, lfTradingPartnerName)
                VALUES (?, ?, ?, ?)
              `;
              const values = [EntryId, Path, undefined, entity];
              try {
                await sqlConn.query(insertQuery, values);
              } catch (error) {
                console.log(error);
              }
            }
          }
        }
      } else {
        tpData[mode] ||= 0;
        tpData[mode] += docs.length;
        for await (const { EntryId, Path } of docs) {
          const insertQuery = `INSERT INTO lfDocs
            (lfEntryId, path, tradingPartnerId, lfTradingPartnerName)
            VALUES (?, ?, ?, ?)
          `;
          const values = [EntryId, Path, undefined, entity];
          try {
            await sqlConn.query(insertQuery, values);
          } catch (error) {
            console.log(error);
          }
        }
      }
    }
  }

  return tpData;
}

export async function findEmptyFolders() {
  const paths = [];
  //const sqlConn = await connectToSql();
  const allEntities = [...new Set([...Object.values(tps).flat(1)])];

  for await (const entity of allEntities) {
    let entityFolder = [];
    try {
      entityFolder = await browse(`/trellis/trading-partners/${entity}`);
      if (entityFolder.length === 0)
        paths.push(`/trellis/trading-partners/${entity}`);
    } catch (error) {
      console.log(error);
      console.log(`No entity ${entity} in Laserfiche`);
      continue;
    }

    for await (const { Name: mode } of entityFolder) {
      const modeFolder = await browse(
        `/trellis/trading-partners/${entity}/${mode}`,
      );
      if (modeFolder.length === 0)
        paths.push(`/trellis/trading-partners/${entity}/${mode}`);
      for await (const { Name: type } of modeFolder) {
        const typeFolder = await browse(
          `/trellis/trading-partners/${entity}/${mode}/${type}`,
        );
        if (typeFolder.length === 0)
          paths.push(`/trellis/trading-partners/${entity}/${mode}/${type}`);
        if (type === "Zendesk Ticket") {
          for await (const { Name: month } of typeFolder) {
            const monthFolder = await browse(
              `/trellis/trading-partners/${entity}/${mode}/${type}/${month}`,
            );
            if (monthFolder.length === 0)
              paths.push(
                `/trellis/trading-partners/${entity}/${mode}/${type}/${month}`,
              );
            for await (const { Name: ticketId } of monthFolder) {
              const ticketFolder = await browse(
                `/trellis/trading-partners/${entity}/${mode}/${type}/${month}/${ticketId}`,
              );
              if (ticketFolder.length === 0)
                paths.push(
                  `/trellis/trading-partners/${entity}/${mode}/${type}/${month}/${ticketId}`,
                );
            }
          }
        }
      }
    }
  }

  await writeFile(
    "emptyFolders.csv",
    csvjson.toCSV(
      paths.map((p) => ({ path: p })),
      {
        delimiter: ",",
        wrap: '"',
      },
    ),
  );
}

export async function findNonEmptyFolders() {
  const paths = [];
  //const sqlConn = await connectToSql();
  const allEntities = [...new Set([...Object.values(tps).flat(1)])];

  for await (const entity of allEntities) {
    let entityFolder = [];
    try {
      entityFolder = await browse(`/trellis/trading-partners/${entity}`);
      if (entityFolder.length === 0)
        paths.push(`/trellis/trading-partners/${entity}`);
    } catch (error) {
      console.log(error);
      console.log(`No entity ${entity} in Laserfiche`);
      continue;
    }

    for await (const { Name: mode } of entityFolder) {
      const modeFolder = await browse(
        `/trellis/trading-partners/${entity}/${mode}`,
      );
      if (hasFiles(modeFolder))
        paths.push(`/trellis/trading-partners/${entity}/${mode}`);
      for await (const { Name: type } of modeFolder) {
        const typeFolder = await browse(
          `/trellis/trading-partners/${entity}/${mode}/${type}`,
        );
        if (type === "Zendesk Ticket") {
          for await (const { Name: month } of typeFolder) {
            const monthFolder = await browse(
              `/trellis/trading-partners/${entity}/${mode}/${type}/${month}`,
            );
            if (hasFiles(monthFolder))
              paths.push(
                `/trellis/trading-partners/${entity}/${mode}/${type}/${month}`,
              );
            for await (const { Name: ticketId } of monthFolder) {
              const ticketFolder = await browse(
                `/trellis/trading-partners/${entity}/${mode}/${type}/${month}/${ticketId}`,
              );
              if (ticketFolder.length > 0)
                paths.push(
                  `/trellis/trading-partners/${entity}/${mode}/${type}/${month}/${ticketId}`,
                );
            }
          }
        } else if (typeFolder.length > 0)
          paths.push(`/trellis/trading-partners/${entity}/${mode}/${type}`);
      }
    }
  }

  await writeFile(
    "nonEmptyFolders.csv",
    csvjson.toCSV(
      paths.map((p) => ({ path: p })),
      {
        delimiter: ",",
        wrap: '"',
      },
    ),
  );
}

export function hasFiles(entry) {
  return entry.some((e) => e.Type !== "Folder");
}

const sql = String.raw;

export async function fillOutSupplierCsv() {
  const sqlConn = await connectToSql();
  const data = await readFile(supplierAlignmentFilename, { encoding: "utf8" });
  const rowData = csvjson.toObject(data, { quote: `"` });
  const outRows = [];

  for await (const row of rowData) {
    row.externalIds = row["In Trellis? If yes, externalids"];
    delete row["In Trellis? If yes, externalids"];

    const result = await sqlConn.query(
      sql`SELECT * FROM tradingPartners WHERE name = ?`,
      [row["Trading Partner"]],
    );
    if (result.length === 0 || result[0].length === 0) {
      outRows.push({
        ...row,
        "Count In Trellis": "",
        "Trellis TP IDs": "",
        "Trellis TP Duplicate Count": 0,
      });
      continue;
    }

    if (result[0].length > 1) {
      console.log("we have duplicates");
    }

    const docs = await sqlConn.query(
      sql`SELECT * FROM docs WHERE tradingPartnerId = ?`,
      [result[0][0].id],
    );

    outRows.push({
      ...row,
      "Count In Trellis": docs[0].length,
      "Trellis TP IDs": result[0].map((obj) => obj.id).join(" "),
      "Trellis TP Duplicate Count": result[0].length,
    });
  }

  await writeFile(supplierAlignmentFilenameNew, csvjson.toCSV(outRows));
}

export async function moveLfDocs(sqlConn, fromName, toName) {
  const moves = [];
  const fromDocs = await sqlConn.query(
    sql`SELECT * FROM lfDocs WHERE lfTradingPartnerName = ?`,
    [fromName],
  );

  if (!fromDocs || fromDocs[0].length === 0) {
    console.log("No docs for", fromName);
  }

  for await (let { lfEntryId /*path: fromPath */ } of fromDocs[0]) {
    lfEntryId = Number.parseInt(lfEntryId, 10);

    try {
      let entry = await retrieveEntry(lfEntryId);
      const fields = Object.fromEntries(
        entry.FieldDataList.map((field) => [
          field.Name,
          field.Name === "Entity"
            ? toName
            : field.isMulti
              ? field.Values
              : field.Value,
        ]),
      );
      fields["Share Mode"] =
        fields["Share Mode"] === "incoming"
          ? "Shared To Smithfield"
          : fields["Share Mode"];
      const fromPath = entry.Path;
      if (lfEntryId !== 1_526_187)
        await setMetadata(lfEntryId, fields, fields["Document Type"]);
      entry = await retrieveEntry(lfEntryId);

      const res = filingWorkflowFromEntry(entry, toName);
      await renameEntry(entry.EntryId, res.path, res.filename);
      entry = await retrieveEntry(lfEntryId);
      /*
    await sqlConn.query(
      `UPDATE lfDocs
      SET
        lfTradingPartnerName = ?,
        path = ?
      WHERE lfEntryId = ?`, [toName, entry.Path, lfEntryId])
      */

      moves.push({
        "LF Entry ID": lfEntryId,
        From: fromPath,
        To: entry.Path,
      });
    } catch (err) {
      console.log(err);
      console.log("error");
    }
  }

  return moves;
}

async function moveSupplierDocs() {
  const sqlConn = await connectToSql();
  const outRows = [];

  for await (const [to, fromArray] of Object.entries(tps)) {
    for await (const from of fromArray) {
      console.log(`Moving from ${from} to ${to}`);
      const fromTp = await sqlConn.query(
        sql`SELECT * FROM tradingPartners WHERE name = ?`,
        [from],
      );

      if (!fromTp || fromTp[0].length === 0) {
        console.log("No trading partner found for", from);
      }

      /*
      // Fix the Trellis trading partners so these don't come back
      for await (const tp of fromTp[0]) {
        // Ensure Trellis no longer uses the wrong them there any longer
        const job = await doJob(oada, {
          type: 'trading-partners-update',
          service: 'trellis-data-manager',
          config: {
            element: {
              masterid: tp.id,
              name: to
            }
          }
        })

        await sqlConn.query(`UPDATE tradingPartners SET name = ? WHERE id = ?`, [to, tp.id]);

        console.log(job);
      }
      */

      outRows.push(...(await moveLfDocs(sqlConn, from, to)));
    }
  }

  await writeFile(
    "SupplierAlignmentFilesMovedTyson.csv",
    csvjson.toCSV(outRows, {
      delimiter: ",",
      wrap: '"',
    }),
  );
}

async function getTrellisDocCount(tpName) {
  let count = 0;
  const tp = Object.values(expand).find((t) => t.name === tpName);
  if (!tp) return count;

  const docTypesPath = `/${tp.bookmarks}/trellisfw/documents/`;
  const { data: docTypes } = await oada.get({
    path: `${docTypesPath}`,
  });

  for await (const docType of Object.keys(docTypes).filter(
    (key) => !key.startsWith("_"),
  )) {
    const { data: docs } = await oada.get({
      path: `${docTypesPath}/${docType}`,
    });
    count += Object.keys(docs || {}).filter(
      (key) => !key.startsWith("_"),
    ).length;
  }

  return count;
}

// Gather the relevant trading-partner information
//await gatherLfEntityInfo();

//await moveSupplierDocs();

//await findEmptyFolders();
//await findNonEmptyFolders();

// Fix up the csv
//await fillOutSupplierCsv();

console.log("DONE");
process.exit();
