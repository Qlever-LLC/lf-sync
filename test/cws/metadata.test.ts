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

import { createDocument, deleteDocument } from '../../dist/cws/documents.js';
import {
  getMetadata,
  setMetadata,
  setTemplate,
} from '../../dist/cws/metadata.js';
import { ROOT_ID } from '../../dist/cws/folders.js';

setup();

test('getMetadata', async (t) => {
  const body = await getMetadata(ROOT_ID);
  t.truthy(body.ID);
});

test('setMetadata', async (t) => {
  const document = await createDocument({
    path: '/',
    name: 'test.create.txt',
  });
  await setMetadata(document, { Author: 'Trellis Test' }, 'General');
  const body = await getMetadata(document);
  t.like(
    body.LaserficheFieldList.find(({ Name: name }) => name === 'Author'),
    { Value: 'Trellis Test' }
  );
  try {
    await deleteDocument(document.LaserficheEntryID);
  } catch {}
});

test('setTemplate', async (t) => {
  const document = await createDocument({
    path: '/',
    name: 'test.create2.txt',
  });
  await setTemplate(document, 'General');
  const body = await getMetadata(document);
  t.is(body.TemplateName, 'General');
  try {
    await deleteDocument(document.LaserficheEntryID);
  } catch {}
});
