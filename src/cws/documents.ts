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

/**
 * Module for dealing with Document Entries in CWS
 *
 * @packageDocumentation
 */

import { PassThrough, Readable } from 'node:stream';
import { Blob } from 'node:buffer';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { FormData } from 'formdata-node';

import {
  type DocumentEntry,
  type DocumentId,
  type EntryIdLike,
  getEntryId,
} from './entries.js';
import { type FieldList, type Metadata, toFieldList } from './metadata.js';
import { type Path, normalizePath } from './paths.js';
import cws from './api.js';
import { streamUpload } from './upload.js';

/**
 * Can be used to set template and field data at time of creation
 * with one transaction, or the setting of template and field data can be done
 * separately through the below setMetadata and setTemplate calls.
 *
 * Also, while this function can upload smaller files,
 * we recommend larger files be uploaded using the chunking methods.
 *
 * @returns The LaserficheEntryID of the newly created document
 */
export async function createDocument({
  path,
  name,
  mimetype,
  volume = 'Default',
  template,
  metadata,
  file,
  buffer,
}: {
  path: Path;
  name: string;
  mimetype: string;
  volume?: string;
  template?: string;
  metadata?: Metadata | FieldList;
  file?: Uint8Array | Blob;
  buffer?: Uint8Array;
}) {
  const form = new FormData();
  const parameters = {
    LaserficheFolderPath: normalizePath(path),
    LaserficheDocumentName: name,
    LaserficheVolumeName: volume,
    LaserficheTemplateName: template,
    LaserficheFieldList: metadata && toFieldList(metadata),
  };
  if (file !== undefined) {
    form.set('File', Buffer.isBuffer(file) ? new Blob([file]) : file, name);
  }

  form.set('Parameters', JSON.stringify(parameters));
  const r = await cws
    .post('api/CreateDocument', {
      body: form,
    })
    .json<{ LaserficheEntryID: DocumentId }>();

  if (buffer) {
    await pipeline(
      Readable.from(buffer),
      streamUpload(
        r.LaserficheEntryID,
        extname(name).slice(1),
        mimetype,
        buffer.length,
      ),
      new PassThrough(),
    );
  }

  return r;
}

export async function createGenericDocument({
  name,
  metadata,
}: {
  name: string;
  metadata?: Record<string, unknown>;
}) {
  const form = new FormData();
  form.set('DocumentName', name);
  if (metadata !== undefined) {
    form.set('Metadata', metadata);
  }

  return cws
    .post('api/CreateGenericDocument', {
      body: form,
    })
    .json<{ LaserficheEntryID: DocumentId }>();
}

export async function deleteDocument(document: EntryIdLike<DocumentEntry>) {
  const id = getEntryId(document);
  return cws.delete<void>('api/DeleteDocument', {
    json: {
      LaserficheEntryId: id,
    },
  });
}

/**
 * Search Laserfiche documents based on a Laserfiche search phrase,
 * including an optional set of requested metadata.
 *
 * Returns an array of matching documents results.
 *
 * @see https://www.laserfiche.com/support/webhelp/Laserfiche/10/en-US/userguide/#../Subsystems/client_wa/Content/Search/Search-Syntax.htm
 * @param phrase
 * @param metadata
 * @returns
 */
export async function searchDocument(
  phrase: string,
  metadata?: ReadonlyArray<string | { Name: string }>,
) {
  return cws
    .post('api/SearchDocument', {
      json: {
        LaserficheSearchPhrase: phrase,
        MetaDataObjectList: metadata?.map((field) =>
          typeof field === 'string' ? { Name: field } : field,
        ),
      },
    })
    .json<DocumentEntry[]>();
}

export async function retrieveDocument(document: EntryIdLike<DocumentEntry>) {
  const id = getEntryId(document);
  return cws
    .get('api/RetrieveDocument', {
      searchParams: { LaserficheEntryId: id },
    })
    .json<DocumentEntry>();
}
