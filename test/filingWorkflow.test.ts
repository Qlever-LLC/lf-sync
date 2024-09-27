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

import test from 'ava';

import {
  filingWorkflow,
  getFormattedDate
} from '../dist/utils.js';

test('filing workflow', (t) => {
  let date = new Date();
  let ticketMeta = {
    Entity: 'Bob Foods, LLC',
    'Document Type': 'Zendesk Ticket',
    'Document Date': getFormattedDate(date),
    'Share Mode': 'Shared to Smithfield',
    'Expiration Date': getFormattedDate(date),
    'Zendesk Ticket ID': '1115',
    Products: ['Honey Glaze', "Brown Sugar Glaze"],
    Locations: ['Location A', 'Location B'],
    'Original Filename': "RandFilename-2.xyz",
  }
  let result = filingWorkflow(ticketMeta);

  t.is(result.filename, 'RandFilename-2.xyz', 'Zendesk Ticket handling')
  t.is(result.path, '/trellis/trading-partners/Bob Foods, LLC/Shared to Smithfield/Zendesk Ticket/2024-09/Ticket1115', 'Zendesk Ticket handling')

  let docMeta = {
    Entity: 'Bob Foods, LLC',
    'Document Type': 'Certificate of Insurance',
    'Document Date': getFormattedDate(date),
    'Share Mode': 'Shared to Smithfield',
    'Expiration Date': getFormattedDate(date),
    Products: ['Honey Glaze', "Brown Sugar Glaze"],
    Locations: ['Location A', 'Location B'],
    'Original Filename': "RandFilename-2.xyz",
  }
  result = filingWorkflow(docMeta);
  let expDate = date.toISOString().split('T')[0];

  t.is(result.filename, `[Certificate of Insurance][Bob Foods, LLC][EXP_${expDate}][Multi-Location][Multi-Product]`, 'Non-ticket filename invalid')
  t.is(result.path, '/trellis/trading-partners/Bob Foods, LLC/Shared to Smithfield/Certificate of Insurance', 'Non-ticket path invalid')

  docMeta.Products.pop();
  docMeta.Locations.pop();
  //@ts-expect-error no likey delete
  delete docMeta['Expiration Date'];
  result = filingWorkflow(docMeta);
  t.is(result.filename, `[Certificate of Insurance][Bob Foods, LLC][Location A][Honey Glaze][Certificate of Insurance]`, 'Non-ticket filename invalid')
  t.is(result.path, '/trellis/trading-partners/Bob Foods, LLC/Shared to Smithfield/Certificate of Insurance', 'Non-ticket path invalid')
});

