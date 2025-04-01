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

/* eslint-disable no-console, no-process-exit, unicorn/no-process-exit */

import { config } from "../dist/config.js";

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import csvjson from "csvjson";

import { connect } from "@oada/client";

const { token: tokens, domain } = config.get("oada");

setInterval(() => console.log("TICK"), 1000);

const oada = await connect({ token: tokens[0] || "", domain });

const startDate = "2024-06-17";
const endDate = "2024-06-23";
const outfilename = `./LF-Sync-Report ${startDate} - ${endDate}.csv`;

const reportsPath =
  "/bookmarks/services/lf-sync/jobs/reports/docs-synced/day-index";
let { data: dates } = await oada.get({ path: reportsPath });

dates = Object.keys(dates).filter((d) => d >= startDate && d <= endDate);

const allRecords = [];

for await (const date of dates) {
  const { data: records } = await oada.get({ path: join(reportsPath, date) });
  dropTrellis(records);
  allRecords.push(
    ...Object.values(records)
      .map((r) => ({
        // Handle some back compatibility with old object keys
        Entity: r.name || r.Entity,
        "Document Type": r.type || r["Document Type"],
        "Document Date": r["Document Date"],
        "Share Mode": r["Share Mode"],
        "LF Entry ID": r.lfEntryId || r["LF Entry ID"],
        "LF Creation Date": r.creationDate || r["LF Creation Date"],
        "Time Reported": r.timeReported || r["Time Reported"],
        "Trellis Document ID": r.trellisDocument || r["Trellis Document ID"],
        "Trellis Document Type": r["Trellis Document Type"],
        "Trellis File ID": r.vdocKey || r["Trellis File ID"],
        "Trellis Trading Partner ID": r.tp || r["Trellis Trading Partner ID"],
      }))
      .map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([key, value]) => [key, `"${value}"`]),
        ),
      ),
  );
}

await writeFile(
  outfilename,
  csvjson.toCSV(allRecords, {
    headers: "key",
    delimiter: ",",
    quote: '"',
  }),
);
function dropTrellis({ _id, _rev, _type, _meta, ...document }) {
  return document;
}

process.exit();
