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

import { Blob } from "node:buffer";

import test from "ava";

import setup from "../setup.js";

import { createDocument, deleteDocument } from "../../dist/cws/documents.js";
import { retrieveDocumentContent } from "../../dist/cws/download.js";

setup();

test("retrieveDocumentContents Blob", async (t) => {
  const file = new Blob(["test test"]);
  const body = await createDocument({
    path: "/",
    name: "test.txt",
    mimetype: "text/plain",
    file,
  });
  const document = await retrieveDocumentContent(body.LaserficheEntryID);
  t.is(document.toString(), "test test");
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test("retrieveDocumentContents Buffer", async (t) => {
  const file = Buffer.from("test test");
  const body = await createDocument({
    path: "/",
    name: "test.txt",
    mimetype: "text/plain",
    file,
  });
  const document = await retrieveDocumentContent(body.LaserficheEntryID);
  t.is(document.toString(), "test test");
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});
