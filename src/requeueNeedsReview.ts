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
  DocumentEntry,
  browse, setMetadata, setTemplate,
  moveEntry
} from './cws/index.js';

import { connect } from '@oada/client';
import { config } from './config.js';
const { token, domain } = config.get('oada');

//1. Get the list of documents in _NeedsReview
//2. Get the EntryID
//3. Look up the entry in trellis? Or parse the trellis resource from the filename?
//4.
const oada = await connect({domain, token: token[0]!});
const files = (await browse(`/_NeedsReview`)) as unknown as DocumentEntry[];
for await (const file of files) {
  try {
    console.log(file.EntryId, JSON.stringify(file, null, 2));
    const fields = Object.fromEntries(
      file.FieldDataList.map(({Name, Value}: any) => ([Name, Value]))
    );
    // Fix the main problems:
    // 1) Share Mode missing
    if (!fields['Share Mode']) {
      fields['Share Mode'] = 'Shared To Smithfield';
    }

    // 2) Entity missing
    if (!fields['Entity']) {
      const { Name } = file; //resources/2EgDoK92MywWuuXp2J9mvUcnGbp-e2ad207f66a22fbc98ab66fc7b5106fe.pdf
      const _id = Name.split('-')[0];
      const { data: pdf } = (await oada.get({
        path: `/${_id}/_meta/vdoc/pdf`
      })) as unknown as { data: any };
      const { data: fldata } = (await oada.get({
        path: `/${pdf![Object.keys(pdf || {})[0]!]._id}/_meta/vdoc/foodlogiq`,
      })) as unknown as { data: any };
      fields['Entity'] = fldata['food-logiq-mirror'].shareSource.sourceBusiness.name
    }

    await setMetadata(file, fields)

    // 3) If Template did not get applied (likely because required fields missing)
    if (!file.TemplateName) {
      if (fields['Document Type']) {
        const tempResult = await setTemplate(file, fields['Document Type']);
        console.log('Fixed Missing Template', tempResult);
      } else {
        console.log('Missing Doc Type', fields, file.EntryId)
      }
    }

    // 4) Trigger the reprocess??? No need so far. setTemplate and setMetadata work fine.
    await moveEntry(file, '/_Incoming');
  } catch(err) {
    console.log(err);
    continue;
  }
}
process.exit();