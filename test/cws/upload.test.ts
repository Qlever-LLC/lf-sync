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

import { Duplex, PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import test from "ava";

import setup from "../setup.js";

import {
  createDocument,
  deleteDocument,
  retrieveDocument,
} from "../../dist/cws/documents.js";
import { retrieveDocumentContent } from "../../dist/cws/download.js";
import {
  chunkedUpload,
  smallUpload,
  streamUpload,
} from "../../dist/cws/upload.js";

setup();

test("small upload", async (t) => {
  const file = Buffer.from("test test");
  const body = await createDocument({
    path: "/",
    name: "test.stream.txt",
    mimetype: "text/plain",
  });
  t.log(await retrieveDocument(body.LaserficheEntryID));
  await smallUpload(body.LaserficheEntryID, file);
  const document = await retrieveDocumentContent(body.LaserficheEntryID);
  t.is(document.toString(), "test test");
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test("stream upload", async (t) => {
  const file = Buffer.from("test test");
  const body = await createDocument({
    path: "/",
    name: "test.stream.txt",
    mimetype: "text/plain",
  });
  const upload = streamUpload(
    body.LaserficheEntryID,
    "txt",
    "text/plain",
    file.length,
  );
  await pipeline(Readable.from(file), upload, new PassThrough());
  const document = await retrieveDocumentContent(body.LaserficheEntryID);
  t.is(document.toString(), "test test");
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});

test.failing("chunked upload", async (t) => {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  async function* gen() {
    yield "test 1";
    yield "test 2";
  }

  const contents = Readable.from(gen(), { objectMode: false });
  const body = await createDocument({
    path: "/",
    name: "test.chunked.txt",
    mimetype: "text/plain",
  });
  const upload = chunkedUpload(body.LaserficheEntryID);
  await pipeline(contents, Duplex.from(upload), new PassThrough());
  const document = await retrieveDocumentContent(body.LaserficheEntryID);
  t.is(document.toString(), "test test");
  try {
    await deleteDocument(body.LaserficheEntryID);
  } catch {}
});
