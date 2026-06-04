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

import { connect } from "@oada/client";
import { pino } from "@oada/pino-debug";
import { config } from "../dist/config.js";
import { createDocument } from "../dist/cws/documents.js";
import { getBuffer } from "../dist/utils.js";

// @ts-expect-error
const { domain, token } = config.get("oada");
const logger = pino({ base: { service: "lf-sync" } });

const oada = await connect({ domain, token });

async function test() {
  try {
    const value = { _id: "resources/2jZ34koXDqOlNjqvrZriXkT1TYR" };
    const { buffer, mimetype } = await getBuffer(logger, oada, value);
    const resp = await createDocument({
      name: "12/31/2021_Amity Packing Company_Certificate of Insurance",
      path: "/_Incoming",
      mimetype,
      metadata: {
        Entity: "Amity Packing Company",
        "Share Mode": "Shared to Smithfield",
        "Document Type": "Certificate of Insurance",
        "Document Date": "12/31/2022 12:00:00 AM",
        Products: ["test1", "test2"],
      },
      template: "Certificate of Insurance",
      buffer,
    });

    //let resp = await moveEntry({ 'LaserficheEntryID': 1520014 }, `/_Incoming`);
    console.log(resp);
  } catch (err) {
    console.log(err);
  }
}

test();
