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
  moveEntry,
  retrieveEntry,
  searchEntries,
} from '../../dist/cws/entries.js';
import { ROOT_ID } from '../../dist/cws/folders.js';

setup();

test('retrieveEntry with ID', async (t) => {
  const result = await retrieveEntry(ROOT_ID);
  t.like(result, { EntryId: ROOT_ID });
});

test('retrieveEntry with path', async (t) => {
  const result = await retrieveEntry('/');
  t.truthy(result.EntryId);
});

test('moveEntry', async (t) => {
  const entry = await createDocument({
    path: '/',
    name: 'test.move.txt',
    mimetype: 'text/plain',
  });
  await moveEntry(entry, '/moved');
  t.pass();
  try {
    await deleteDocument(entry.LaserficheEntryID);
  } catch {}
});

test('searchEntries', async (t) => {
  const phrase =
    '{[General]:[Document]="search text", [Date]="*"} & {LF:Name="*", Type="F"}';
  const result = await searchEntries(phrase);
  t.assert(Array.isArray(result));
});
