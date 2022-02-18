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

import setup from './setup.js';

// Import ksuid from 'ksuid';

import {
  ROOT_ID,
  browse,
  createDocument,
  deleteDocument,
  getFolderContents,
} from '../dist/cws.js';

setup();

test.beforeEach(async () => {
  /*
  Const { string: id } = await ksuid.random();
  t.context = id;
  config.set(
    'laserfiche.baseFolder',
    join(baseFolder, `test-${id}`) as `/${string}`
  );
  */
});

test('browse folder', async (t) => {
  const entries = await browse('/');
  t.assert(entries.length > 0);
});

test('get root contents', async (t) => {
  const entries = await getFolderContents(ROOT_ID);
  t.assert(entries.length > 0);
});

test('createDocument', async (t) => {
  // Const file = Buffer.from('test test');
  const body = await createDocument({
    path: '/',
    name: 'test.txt',
    // File,
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test('deleteDocument', async (t) => {
  const body = await createDocument({
    path: '/',
    name: 'test.txt',
  });
  await deleteDocument(body.LaserficheEntryID);
  t.pass();
});
