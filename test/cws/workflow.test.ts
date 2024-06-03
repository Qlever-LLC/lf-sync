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

import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout } from 'node:timers/promises';

import test from 'ava';

import setup from '../setup.js';

import fs from 'node:fs/promises';

import {
  createDocument,
  deleteDocument,
  retrieveDocument,
} from '../../dist/cws/documents.js';
import { smallUpload, streamUpload } from '../../dist/cws/upload.js';
import { retrieveDocumentContent } from '../../dist/cws/download.js';

setup();

test('smallUpload', async (t) => {
  const file = await fs.readFile('./test/test.pdf');
  const { LaserficheEntryID: id } = await createDocument({
    path: '/../../_Incoming',
    name: 'test.workflow.small.pdf',
    template: 'SFI Template 1',
    metadata: {
      'Document Date': new Date().toISOString(),
      'Expiration Date': new Date().toISOString(),
      'Entity': 'Trellis Test Supplier',
      'Document Type (2)': 'Certificate of Insurance',
      'Share Mode': 'Shared To Smithfield',
    },
  } as const);
  await smallUpload(id, file);
  const content = await retrieveDocumentContent(id);
  t.is(content.toString(), file.toString());
  const entry = await retrieveDocument(id);
  t.regex(
    entry.Path,
    /^\\FSQA\\Trellis\\Trading Partners\\.*/,
    'Should be moved by workflow'
  );
  t.log(entry);
  try {
    await deleteDocument(id);
  } catch {}
});

test('streamUpload', async (t) => {
  const file = await fs.readFile('./test/test.pdf');
  const { LaserficheEntryID: id } = await createDocument({
    path: '/../../_Incoming',
    name: 'test.workflow.stream.pdf',
    template: 'SFI Template 1',
    metadata: {
      'Document Date': new Date().toISOString(),
      'Expiration Date': new Date().toISOString(),
      'Entity': 'Trellis Test Supplier',
      'Document Type (2)': 'Certificate of Insurance',
      'Share Mode': 'Shared To Smithfield',
    },
  } as const);
  const upload = streamUpload(id, 'pdf', 'application/pdf', file.length);
  await pipeline(Readable.from(file), upload, new PassThrough());
  await setTimeout(1000);
  const content = await retrieveDocumentContent(id);
  t.is(content.toString(), file.toString());
  const entry = await retrieveDocument(id);
  t.regex(
    entry.Path,
    /^\\FSQA\\Trellis\\Trading Partners\\.*/,
    'Should be moved by workflow'
  );
  t.log(entry);
  try {
    await deleteDocument(id);
  } catch {}
});
