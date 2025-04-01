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

import test from "ava";

import setup from "../setup.js";

import {
  ROOT_ID,
  browse,
  createFolder,
  deleteFolder,
  getFolderContents,
  retrieveFolder,
} from "../../dist/cws/folders.js";

setup();

test("browse", async (t) => {
  const results = await browse("/");
  t.assert(Array.isArray(results));
});

test("retrieveFolder", async (t) => {
  const folder = await retrieveFolder(ROOT_ID);
  t.is(folder.LaserficheEntryID, ROOT_ID);
});

test("getFolderContents", async (t) => {
  const document = await getFolderContents(ROOT_ID);
  t.assert(Array.isArray(document));
});

test("createFolder", async (t) => {
  const body = await createFolder({
    path: "/test.create.folder/",
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteFolder(body.LaserficheEntryID);
  } catch {}
});

test("deleteFolder", async (t) => {
  const body = await createFolder({
    path: "/test.delete.folder/",
  });
  await deleteFolder(body.LaserficheEntryID);
  t.pass();
});
