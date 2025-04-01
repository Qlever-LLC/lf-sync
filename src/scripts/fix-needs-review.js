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

import { connect } from "@oada/client";

import { browse } from "../dist/cws/folders.js";

const { token: tokens, domain } = config.get("oada");

setInterval(() => console.log("TICK"), 1000);

/*
This script was written to handle some documents that landed in the _NeedsReview folder due to the filing workflow
failing. This occurs when necessary metadata elements are missing from the document including
1) Date, 2) Entity, 3) Share Mode, 4) Document Type

To reuse this in the future, fix the transformers such that the necessary metadata items are
no longer missing, then run this script to 'retrigger' them to be processed by lf-sync by
getting them and re-putting the resource content.
*/

const oada = await connect({ token: tokens[0] || "", domain });

const data = await browse("/_NeedsReview");

for await (const entry of data) {
  const path = `/${entry.Name.split("-")[0]}`;
  const { data: tDoc } = await oada.get({ path });
  await oada.put({
    path,
    data: tDoc,
    contentType: tDoc._type,
  });
  console.log(`completed Entry ${entry.EntryId} at path ${path}`);
}

process.exit();
