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

import setup from '../setup.js';

import { PassThrough, Readable } from 'node:stream';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import {
  createDocument,
  deleteDocument,
  retrieveDocument,
} from '../../dist/cws/documents.js';
import { retrieveDocumentContent } from '../../dist/cws/download.js';
import { streamUpload } from '../../dist/cws/upload.js';

setup();

test('should trigger workflow', async (t) => {
  const file = await fs.readFile('./test/test.pdf');
  const { LaserficheEntryID: id } = await createDocument({
    path: '/../../_Incoming',
    name: 'test.workflow.pdf',
    template: 'Template 1',
    metadata: {
      'Document Date': new Date().toISOString(),
      'Expiration Date': new Date().toISOString(),
      'Entity': 'Trellis Test Supplier',
      'Document Type (2)': 'COI',
      'Share Mode': 'Shared In',
    },
  } as const);
  const upload = streamUpload(id, 'pdf');
  await pipeline(Readable.from(file), upload, new PassThrough());
  const content = await retrieveDocumentContent(id);
  t.is(content.toString(), 'test test');
  const entry = await retrieveDocument(id);
  t.regex(
    entry.Path,
    /^\/FSQA\/Trellis\/Trading Partners\//,
    'Should be moved by workflow'
  );
  t.log(entry);
  try {
    await deleteDocument(id);
  } catch {}
});
