/**
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

import {
  createDocument,
  createGenericDocument,
  deleteDocument,
  retrieveDocument,
  searchDocument,
} from '../../dist/cws/documents.js';

setup();

test('createDocument', async (t) => {
  const body = await createDocument({
    path: '/',
    name: 'test.create.txt',
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test.failing('createGenericDocument', async (t) => {
  // Const file = Buffer.from('test test');
  const body = await createGenericDocument({
    type: 'file',
    name: 'test.generic.txt',
    // File,
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test('retrieveDocument', async (t) => {
  const body = await createDocument({
    path: '/',
    name: 'test.retrieve.txt',
  });
  const document = await retrieveDocument(body.LaserficheEntryID);
  t.is(document.LaserficheEntryID, body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test('searchDocument', async (t) => {
  const phrase =
    '{[General]:[Document]="search text", [Date]="*"} & {LF:Name="*", Type="F"}';
  const result = await searchDocument(phrase);
  t.assert(Array.isArray(result));
});

test('deleteDocument', async (t) => {
  const body = await createDocument({
    path: '/',
    name: 'test.delete.txt',
  });
  await deleteDocument(body.LaserficheEntryID);
  t.pass();
});
