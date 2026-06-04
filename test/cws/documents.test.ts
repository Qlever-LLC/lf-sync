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
import {
  createDocument,
  createGenericDocument,
  deleteDocument,
  retrieveDocument,
  searchDocument,
} from "../../dist/cws/documents.js";
import setup from "../setup.js";

setup();

test("createDocument", async (t) => {
  const body = await createDocument({
    path: "/",
    name: "test.create.txt",
    mimetype: "text/plain",
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test("createDocument with file", async (t) => {
  const file = Buffer.from("test test");
  const body = await createDocument({
    path: "/",
    name: "test.create.file.txt",
    mimetype: "text/plain",
    file,
  });
  t.log(await retrieveDocument(body.LaserficheEntryID));
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test.failing("createGenericDocument", async (t) => {
  const body = await createGenericDocument({
    name: "test.generic.txt",
  });
  t.truthy(body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test("retrieveDocument", async (t) => {
  const body = await createDocument({
    path: "/",
    name: "test.retrieve.txt",
    mimetype: "text/plain",
  });
  const document = await retrieveDocument(body.LaserficheEntryID);
  t.is(document.LaserficheEntryID, body.LaserficheEntryID);
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test("searchDocument", async (t) => {
  const phrase =
    '{[General]:[Document]="search text", [Date]="*"} & {LF:Name="*", Type="F"}';
  const result = await searchDocument(phrase);
  t.assert(Array.isArray(result));
});

test("deleteDocument", async (t) => {
  const body = await createDocument({
    path: "/",
    name: "test.delete.txt",
    mimetype: "text/plain",
  });
  await deleteDocument(body.LaserficheEntryID);
  t.pass();
});
